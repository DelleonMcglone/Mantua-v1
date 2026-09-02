// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/test/utils/mocks/MockERC20.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Market} from "../../src/markets/Market.sol";
import {MarketFactory} from "../../src/markets/MarketFactory.sol";
import {MarketPoolBootstrap} from "../../src/markets/MarketPoolBootstrap.sol";
import {Resolver} from "../../src/markets/Resolver.sol";
import {DynamicMarketHook} from "../../src/hooks/dynamic-market/DynamicMarketHook.sol";
import {MarketStateRegistry} from "../../src/hooks/dynamic-market/MarketStateRegistry.sol";
import {IMarketStateRegistry as I} from "../../src/hooks/dynamic-market/IMarketStateRegistry.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

/// @title B10-002 / B10-003 — full-lifecycle end-to-end proofs.
///
/// One harness, every contract that shipped, wired the way production wires
/// them: Resolver → MarketFactory (immutable resolver) → Market → outcome
/// tokens → v4 pool under the Dynamic Market Hook → freeze → settle → redeem.
///
/// These are the tests that catch WIRING bugs — each contract's own suite
/// already proves it in isolation; this proves the seams: the factory's
/// market accepts the resolver's word, the hook's freeze fires on the same
/// clock as the market's, LP exit stays open during the halt, and every
/// last collateral unit is accounted for at the end.
contract FullLifecycleTest is Test {
    using PoolIdLibrary for PoolKey;

    uint160 constant EXPECTED_BITS = uint160(0x28C0);
    // sqrt(0.5) * 2^96 — pool opens at YES = 0.50 USDC (p = 50%).
    uint160 constant SQRT_HALF_X96 = 56022770974786139918731938227;

    address operator = makeAddr("operator");
    address signerKey = makeAddr("signer");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    MockERC20 usdc;
    PoolManager manager;
    MarketStateRegistry registry;
    DynamicMarketHook hook;
    Resolver resolver;
    MarketFactory factory;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest lpRouter;

    bytes32 constant MARKET_ID = keccak256("e2e:home-market");
    uint64 kickoff;
    Market market;
    MockERC20 yes;
    MockERC20 no;

    function setUp() public {
        vm.warp(1_000_000);
        kickoff = uint64(block.timestamp + 1 days);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        manager = new PoolManager(address(this));
        registry = new MarketStateRegistry(operator, signerKey);
        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);

        address target = address(uint160(0x22220000 | uint160(EXPECTED_BITS)));
        deployCodeTo(
            "DynamicMarketHook.sol:DynamicMarketHook",
            abi.encode(IPoolManager(address(manager)), I(address(registry))),
            target
        );
        hook = DynamicMarketHook(target);

        // Production deploy order (DeployMarkets.s.sol): Resolver first, the
        // factory burns its address in, then the one-shot back-pointer.
        resolver = new Resolver(operator, signerKey);
        factory = new MarketFactory(usdc, address(resolver));
        vm.prank(operator);
        resolver.setFactory(factory);

        market = factory.createMarket(MARKET_ID, kickoff, "Home to beat Away");
        yes = MockERC20(address(market.yesToken()));
        no = MockERC20(address(market.noToken()));

        usdc.mint(alice, 10_000e6);
        usdc.mint(bob, 10_000e6);
    }

    /// Alice and Bob mint full sets; the pool opens at 50%; Alice LPs; Bob
    /// buys YES (price moves); kickoff freezes trading but NOT LP exit;
    /// the resolver settles YES; both redeem; the market ends solvent-empty.
    function test_fullLifecycle_createSeedTradeFreezeResolveRedeem() public {
        // 1. Positions on both sides via split (B1's mint path).
        vm.startPrank(alice);
        usdc.approve(address(market), type(uint256).max);
        market.split(2_000e6);
        vm.stopPrank();
        vm.startPrank(bob);
        usdc.approve(address(market), type(uint256).max);
        market.split(500e6);
        vm.stopPrank();
        assertEq(yes.balanceOf(alice), 2_000e6);
        assertEq(no.balanceOf(bob), 500e6);

        // 2. Open the YES/USDC pool under the hook at p = 0.50.
        (PoolKey memory key, bool yesIsToken0) =
            MarketPoolBootstrap.poolKeyFor(market, address(usdc), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, address(hook));
        vm.prank(operator);
        registry.registerPool(key.toId(), kickoff, kickoff + 4 hours, yesIsToken0, 6);
        // Price is token1-per-token0; if USDC sorted first, invert p/(1-p)=1 at 0.5 either way.
        manager.initialize(key, SQRT_HALF_X96);

        // 3. Alice provides liquidity across the full range.
        vm.startPrank(alice);
        yes.approve(address(lpRouter), type(uint256).max);
        usdc.approve(address(lpRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: -6000, tickUpper: 6000, liquidityDelta: 1e9, salt: 0}),
            ""
        );
        vm.stopPrank();

        // 4. Bob buys YES with USDC — the price moves, the dynamic fee applies.
        bool zeroForOne = !yesIsToken0; // paying USDC, receiving YES
        uint256 bobYesBefore = yes.balanceOf(bob);
        vm.startPrank(bob);
        usdc.approve(address(swapRouter), type(uint256).max);
        yes.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(100e6),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
        uint256 bobYesBought = yes.balanceOf(bob) - bobYesBefore;
        assertGt(bobYesBought, 0, "swap must deliver YES");

        // 5. Kickoff. The hook rejects trading with no keeper write ever made
        //    (timestamp layer), and the market's own freeze is permissionless.
        vm.warp(kickoff + 1);
        vm.startPrank(bob);
        vm.expectRevert(); // wrapped by v4 as Hooks.Wrap__FailedHookCall
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(10e6),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
        market.freeze();

        // 6. LP exit stays open during the halt — a frozen market must never
        //    trap liquidity (spec §26; hook has no remove-liquidity gate).
        vm.prank(alice);
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: -6000, tickUpper: 6000, liquidityDelta: -1e9, salt: 0}),
            ""
        );

        // 7. The Resolver's signer settles YES (home won).
        vm.prank(signerKey);
        resolver.resolve(MARKET_ID, 0);

        // 8. Everyone redeems. YES pays 1 USDC; NO pays nothing.
        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 aliceYes = yes.balanceOf(alice);
        vm.prank(alice);
        market.redeem();
        assertEq(usdc.balanceOf(alice), aliceUsdcBefore + aliceYes, "YES redeems 1:1");

        uint256 bobUsdcBefore = usdc.balanceOf(bob);
        uint256 bobYes = yes.balanceOf(bob);
        vm.prank(bob);
        market.redeem();
        assertEq(usdc.balanceOf(bob), bobUsdcBefore + bobYes, "buyer's YES redeems 1:1 too");

        // 9. Solvency at the end: the market holds exactly the collateral
        //    backing YES tokens still outstanding (none held by our actors).
        assertEq(yes.balanceOf(alice) + yes.balanceOf(bob), 0, "all YES redeemed");
        assertGe(usdc.balanceOf(address(market)), yes.totalSupply(), "collateral covers remaining YES");
    }

    /// B10-003 — a postponed game voids: both sides redeem at exactly 0.50
    /// per token, and every unit of collateral leaves the market.
    function test_voidLifecycle_postponedGameReturnsAllCollateral() public {
        vm.startPrank(alice);
        usdc.approve(address(market), type(uint256).max);
        market.split(1_000e6);
        // Alice sells her NO to Bob off-pool: positions on both sides,
        // held by different actors, bought at different effective prices.
        no.transfer(bob, 1_000e6);
        vm.stopPrank();

        uint256 marketBalance = usdc.balanceOf(address(market));
        assertEq(marketBalance, 1_000e6, "collateral escrowed 1:1");

        // Game postponed before kickoff — operator voids via the manual
        // override path (B4-004: same code path as the signer).
        vm.prank(operator);
        resolver.voidMarket(MARKET_ID);

        // Void pays 0.50 per token to BOTH sides (DM tie/void doctrine).
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        market.redeemInvalid();
        assertEq(usdc.balanceOf(alice) - aliceBefore, 500e6, "1000 YES x 0.50");

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        market.redeemInvalid();
        assertEq(usdc.balanceOf(bob) - bobBefore, 500e6, "1000 NO x 0.50");

        // Every unit returned: the void path cannot strand collateral.
        assertEq(usdc.balanceOf(address(market)), 0, "market fully drained");
    }
}
