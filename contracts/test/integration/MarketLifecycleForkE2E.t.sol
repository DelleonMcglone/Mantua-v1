// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {BaseFork} from "./BaseFork.t.sol";
import {ERC20} from "solmate/tokens/ERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {HookMiner} from "../../src/lib/HookMiner.sol";
import {Market} from "../../src/markets/Market.sol";
import {MarketFactory} from "../../src/markets/MarketFactory.sol";
import {MarketPoolBootstrap} from "../../src/markets/MarketPoolBootstrap.sol";
import {Resolver} from "../../src/markets/Resolver.sol";
import {DynamicMarketHook} from "../../src/hooks/dynamic-market/DynamicMarketHook.sol";
import {MarketStateRegistry} from "../../src/hooks/dynamic-market/MarketStateRegistry.sol";
import {IMarketStateRegistry as I} from "../../src/hooks/dynamic-market/IMarketStateRegistry.sol";

/**
 * P-014 — full market lifecycle on a Base Mainnet fork, under the D-103
 * in-play trading semantics, with REAL mainnet USDC.
 *
 * The local `test/e2e/FullLifecycle.t.sol` proves the same journey against
 * a mock USDC and a local PoolManager. This suite re-runs it in the
 * environment the deploy scripts actually target: forked Base Mainnet
 * (8453), the canonical USDC (`0x8335…2913`, a FiatToken proxy — six
 * decimals, upgradeable, blacklistable — none of which a MockERC20
 * exercises), and the stack wired exactly the way
 * `DeployDynamicMarket.s.sol` + `DeployMarkets.s.sol` wire it:
 *
 *   - a DEDICATED PoolManager (DM-112 routing: the DM stack self-deploys
 *     its manager; the canonical v4 PoolManager is not used),
 *   - the hook at a CREATE2-mined address whose low 14 bits encode exactly
 *     the four permissions (`0x28C0`) — mined with HookMiner, as the
 *     script does, not planted with `deployCodeTo`,
 *   - Resolver → MarketFactory (immutable resolver) → one-shot setFactory,
 *   - periphery routers against the DM PoolManager (task 032, finding 3).
 *
 * The journey: create market → split both sides → open the hooked pool at
 * the implied probability → LP → trade both directions pre-kickoff → warp
 * past kickoff → **trade during the game succeeds** (the leg the old
 * kickoff-freeze design forbade) → resolver freezes on "final" → swaps
 * blocked but LP exit open → resolve → winning side redeems 1:1 real
 * USDC, losing side gets zero → every balance accounted, market solvent.
 *
 * Runs whenever the fork RPC is reachable (BaseFork conventions: no
 * env-gated hook address is needed because the whole stack is deployed
 * inside the fork). From repo root:
 *
 *   BASE_RPC_URL=https://mainnet.base.org \
 *     forge test --root contracts --match-contract MarketLifecycleForkE2E -vv
 */
contract MarketLifecycleForkE2E is BaseFork {
    using PoolIdLibrary for PoolKey;

    /// Canonical Base Mainnet USDC (FiatToken proxy) — the real collateral.
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    /// The four spec §7 permissions; the mined address must encode exactly these.
    uint160 internal constant PERMISSIONS =
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;

    // sqrt(0.5) * 2^96 and sqrt(2) * 2^96 — the p = 0.50 opening price for
    // each token ordering (v4 price is token1-per-token0; at p = 0.5 one YES
    // is 0.5 USDC, so the ratio is 0.5 or 2 depending on which side sorted
    // first). Chosen at runtime because YES's address is nonce-dependent.
    uint160 internal constant SQRT_HALF_X96 = 56022770974786139918731938227;
    uint160 internal constant SQRT_TWO_X96 = 112045541949572279837463876454;

    address internal operator = makeAddr("fork_operator");
    address internal signerKey = makeAddr("fork_signer"); // keeper = resolver key (spec §0.1)
    address internal alice = makeAddr("fork_alice");
    address internal bob = makeAddr("fork_bob");
    address internal carol = makeAddr("fork_carol");

    bytes32 internal constant MARKET_ID = keccak256("fork-e2e:home-market");

    IPoolManager internal manager;
    MarketStateRegistry internal registry;
    DynamicMarketHook internal hook;
    Resolver internal resolver;
    MarketFactory internal factory;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;

    ERC20 internal usdc;
    uint64 internal kickoff;
    Market internal market;
    ERC20 internal yes;
    ERC20 internal no;

    function setUp() public override {
        super.setUp(); // fork Base Mainnet, assert chain id 8453
        usdc = ERC20(BASE_USDC);
        require(BASE_USDC.code.length > 0, "fork: USDC has no code");
        assertEq(usdc.decimals(), 6, "canonical USDC must be 6dp");

        kickoff = uint64(block.timestamp + 1 days);

        // ── DeployDynamicMarket.s.sol, mirrored ──
        // deployCode rather than `new PoolManager`: v4-core pins PoolManager
        // to solc =0.8.26 while the BaseFork harness requires ^0.8.27, so
        // the concrete import cannot share a compilation unit with this file.
        manager = IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(operator)));
        registry = new MarketStateRegistry(operator, signerKey);
        bytes memory args = abi.encode(IPoolManager(address(manager)), I(address(registry)));
        // In-test CREATE2 deploys from the test contract, so mine against
        // address(this); the script mines against the canonical proxy. The
        // property under test — low bits encode exactly the permissions —
        // is identical.
        (address predicted, bytes32 salt) =
            HookMiner.find(address(this), PERMISSIONS, type(DynamicMarketHook).creationCode, args);
        hook = new DynamicMarketHook{salt: salt}(IPoolManager(address(manager)), I(address(registry)));
        assertEq(address(hook), predicted, "mined address mismatch");
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, PERMISSIONS, "permission bits wrong");

        // ── DeployMarkets.s.sol, mirrored (Resolver first, factory burns it
        //    in, one-shot back-pointer) ──
        resolver = new Resolver(operator, signerKey);
        factory = new MarketFactory(usdc, address(resolver));
        vm.prank(operator);
        resolver.setFactory(factory);

        // ── DeployMarketPeriphery.s.sol, mirrored: routers against the DM
        //    PoolManager, not the canonical one ──
        swapRouter = new PoolSwapTest(IPoolManager(address(manager)));
        lpRouter = new PoolModifyLiquidityTest(IPoolManager(address(manager)));

        // Real mainnet USDC, dealt.
        deal(BASE_USDC, alice, 10_000e6);
        deal(BASE_USDC, bob, 10_000e6);
    }

    function test_forkLifecycle_inPlayTradingFreezeOnFinalResolveRedeem() public {
        // ── 1. Create the market ──
        market = factory.createMarket(MARKET_ID, kickoff, "Home to beat Away");
        yes = ERC20(address(market.yesToken()));
        no = ERC20(address(market.noToken()));
        uint256 aliceStart = usdc.balanceOf(alice);
        uint256 bobStart = usdc.balanceOf(bob);

        // ── 2. Split both sides: real USDC escrowed 1:1 ──
        vm.startPrank(alice);
        usdc.approve(address(market), type(uint256).max);
        market.split(2_000e6);
        vm.stopPrank();
        vm.startPrank(bob);
        usdc.approve(address(market), type(uint256).max);
        market.split(500e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(market)), 2_500e6, "collateral escrowed 1:1");
        assertEq(market.outstandingSets(), 2_500e6);

        // ── 3. Open the hooked pool at the implied probability (p = 0.50) ──
        (PoolKey memory key, bool yesIsToken0) =
            MarketPoolBootstrap.poolKeyFor(market, BASE_USDC, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, address(hook));
        PoolId poolId = key.toId();
        vm.prank(operator);
        registry.registerPool(poolId, kickoff, kickoff + 4 hours, yesIsToken0, 6, true);
        MarketPoolBootstrap.initializePool(
            IPoolManager(address(manager)), key, yesIsToken0 ? SQRT_HALF_X96 : SQRT_TWO_X96
        );

        // Keeper feed: pre-game, model at parity, high confidence.
        vm.prank(signerKey);
        registry.updateMarket(poolId, 5000, 8000, I.EventState.PRE_GAME);

        // ── 4. Alice LPs around the opening price ──
        vm.startPrank(alice);
        yes.approve(address(lpRouter), type(uint256).max);
        usdc.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: -12000, tickUpper: 12000, liquidityDelta: 1e9, salt: 0}), ""
        );
        vm.stopPrank();

        // ── 5. Pre-kickoff trading, both directions ──
        bool buyYesZeroForOne = !yesIsToken0; // paying USDC, receiving YES
        vm.startPrank(bob);
        usdc.approve(address(swapRouter), type(uint256).max);
        yes.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();

        uint256 bobYesBefore = yes.balanceOf(bob);
        _swap(bob, key, buyYesZeroForOne, -int256(80e6)); // buy YES with $80
        uint256 bought = yes.balanceOf(bob) - bobYesBefore;
        assertGt(bought, 0, "pre-kickoff buy must deliver YES");

        uint256 bobUsdcBefore = usdc.balanceOf(bob);
        _swap(bob, key, !buyYesZeroForOne, -int256(bought / 4)); // sell a quarter back
        assertGt(usdc.balanceOf(bob), bobUsdcBefore, "pre-kickoff sell must deliver USDC");

        // ── 6. Kickoff passes — and trading CONTINUES (D-103 in-play).
        //       The old design's hook halted here with MarketFrozen. ──
        vm.warp(kickoff + 1 hours);
        vm.prank(signerKey);
        registry.updateMarket(poolId, 6000, 7000, I.EventState.LIVE);
        assertTrue(market.isTradeable(), "in-play market reports tradeable");

        uint256 bobYesMidGame = yes.balanceOf(bob);
        _swap(bob, key, buyYesZeroForOne, -int256(50e6)); // the in-game leg
        assertGt(yes.balanceOf(bob), bobYesMidGame, "IN-PLAY swap must succeed and deliver YES");

        // split/merge stay open while trading is open (D-103).
        vm.prank(bob);
        market.split(25e6);
        assertEq(market.outstandingSets(), 2_525e6);

        // A stranger cannot force the freeze during the event window.
        vm.expectRevert(Market.TooEarlyToFreeze.selector);
        market.freeze();

        // ── 7. Final whistle: data-driven freeze (keeper FINAL + resolver
        //       freeze), swaps blocked, LP exit open ──
        vm.warp(kickoff + 4 hours);
        vm.prank(signerKey);
        registry.updateMarket(poolId, 6000, 9000, I.EventState.FINAL);
        vm.prank(signerKey);
        resolver.freeze(MARKET_ID);
        assertEq(uint8(market.state()), uint8(Market.State.FROZEN));

        vm.startPrank(bob);
        vm.expectRevert(); // hook halts; v4 wraps as Hooks.Wrap__FailedHookCall
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: buyYesZeroForOne,
                amountSpecified: -int256(10e6),
                sqrtPriceLimitX96: buyYesZeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.expectRevert(Market.NotOpen.selector);
        market.split(10e6);
        vm.stopPrank();

        // LP exit must stay open during the halt (spec §23).
        vm.prank(alice);
        lpRouter.modifyLiquidity(
            key, ModifyLiquidityParams({tickLower: -12000, tickUpper: 12000, liquidityDelta: -1e9, salt: 0}), ""
        );

        // ── 8. Resolve YES via the Resolver's signer path ──
        vm.prank(signerKey);
        resolver.resolve(MARKET_ID, 0);
        assertEq(uint8(market.state()), uint8(Market.State.RESOLVED));

        // ── 9. Redeem: winners 1:1 in real USDC, losers zero ──
        // Carol holds ONLY the losing side (NO), transferred from Alice.
        vm.prank(alice);
        no.transfer(carol, 100e6);
        vm.prank(carol);
        vm.expectRevert(Market.NothingToRedeem.selector);
        market.redeem(); // the losing side redeems nothing

        uint256 aliceYes = yes.balanceOf(alice);
        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        market.redeem();
        assertEq(usdc.balanceOf(alice) - aliceUsdcBefore, aliceYes, "alice's YES redeems 1:1 USDC");

        uint256 bobYes = yes.balanceOf(bob);
        uint256 bobUsdcBeforeRedeem = usdc.balanceOf(bob);
        vm.prank(bob);
        market.redeem();
        assertEq(usdc.balanceOf(bob) - bobUsdcBeforeRedeem, bobYes, "bob's YES redeems 1:1 USDC");

        // ── 10. Full accounting over REAL USDC ──
        // No actor holds unredeemed YES; the vault still covers whatever YES
        // remains outstanding (swap-fee YES accrued to the pool).
        assertEq(yes.balanceOf(alice) + yes.balanceOf(bob) + yes.balanceOf(carol), 0, "all actor YES redeemed");
        assertEq(
            usdc.balanceOf(address(market)),
            market.outstandingSets(),
            "vault holds exactly the collateral backing outstanding sets"
        );
        assertEq(market.outstandingSets(), yes.totalSupply(), "outstanding sets == redeemable winning supply");
        assertGe(market.collateralSurplus(), 0, "solvency invariant holds at the end");

        // Conservation: USDC only moved between actors, the vault, and the
        // pool — the system minted nothing and burned nothing.
        uint256 actorsNow = usdc.balanceOf(alice) + usdc.balanceOf(bob) + usdc.balanceOf(carol);
        uint256 systemNow = usdc.balanceOf(address(market)) + usdc.balanceOf(address(manager));
        assertEq(actorsNow + systemNow, aliceStart + bobStart, "every USDC unit accounted for");
    }

    function _swap(address who, PoolKey memory key, bool zeroForOne, int256 amountSpecified) internal {
        vm.prank(who);
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }
}
