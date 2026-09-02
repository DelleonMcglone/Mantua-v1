// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {BaseFork} from "./BaseFork.t.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {MockERC20} from "solmate/test/utils/mocks/MockERC20.sol";

/**
 * P9-002 — full create → add → swap → remove lifecycle on a Base
 * Mainnet fork.
 *
 * This is the integration test the existing per-hook E2Es don't cover:
 * each of those exercises one stage (init + a single swap, or just swap)
 * but none walk the user through the whole flow the v2 client puts in
 * front of them.
 *
 * The test forks Base Mainnet, deploys two mock 6-decimal stablecoins
 * (so we don't dirty the canonical USDC/EURC pools), initializes a
 * Stable Protection pool against the live hook, adds liquidity, swaps
 * in both directions, removes a portion of the liquidity, and asserts
 * the bookkeeping at each step.
 *
 * The hook has no Base Mainnet deployment yet — until
 * `STABLE_PROTECTION_HOOK_ADDRESS` is set, every test here skips.
 *
 * Run from `contracts/`:
 *   forge test --match-path "test/integration/FullLifecycleE2E.t.sol" -vv
 *
 * Or, with a pinned RPC, from repo root:
 *   BASE_RPC_URL=https://mainnet.base.org \
 *     forge test --match-path "test/integration/FullLifecycleE2E.t.sol" -vv
 */
contract FullLifecycleE2E is BaseFork {
    using PoolIdLibrary for PoolKey;

    // sqrt(1) * 2^96 — initial price for an even-decimal stable pair.
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    // Full-range tick bounds for tickSpacing=60, the canonical 0.30%
    // tier value. Stable Protection forces dynamic fees, so the static
    // tier here is purely a tickSpacing pick — 60 keeps the test cheap.
    int24 internal constant TICK_LOWER = -887_220;
    int24 internal constant TICK_UPPER = 887_220;

    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest liqRouter;
    MockERC20 usdcMock;
    MockERC20 eurcMock;
    PoolKey poolKey;

    function setUp() public override {
        super.setUp();
        // Hook-dependent setup only runs once the mainnet deploy lands;
        // tests call _requireHook and skip until then.
        if (STABLE_PROTECTION_HOOK == address(0)) return;
        IPoolManager manager = IPoolManager(V4_POOL_MANAGER_BASE);
        swapRouter = new PoolSwapTest(manager);
        liqRouter = new PoolModifyLiquidityTest(manager);

        // Two 6-decimal stablecoin mocks. Address sort matters for v4 —
        // mirror the production canonicalization (currency0 < currency1).
        MockERC20 a = new MockERC20("Mock USDC", "mUSDC", 6);
        MockERC20 b = new MockERC20("Mock EURC", "mEURC", 6);
        (usdcMock, eurcMock) = address(a) < address(b) ? (a, b) : (b, a);

        usdcMock.mint(address(this), 1_000_000e6);
        eurcMock.mint(address(this), 1_000_000e6);
        usdcMock.approve(address(swapRouter), type(uint256).max);
        eurcMock.approve(address(swapRouter), type(uint256).max);
        usdcMock.approve(address(liqRouter), type(uint256).max);
        eurcMock.approve(address(liqRouter), type(uint256).max);

        poolKey = PoolKey({
            currency0: Currency.wrap(address(usdcMock)),
            currency1: Currency.wrap(address(eurcMock)),
            // Stable Protection demands the dynamic-fee flag in
            // beforeInitialize — same constraint the client+server now
            // satisfy via `effectivePoolFee`.
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: int24(60),
            hooks: IHooks(STABLE_PROTECTION_HOOK)
        });
    }

    /**
     * Walks every stage the v2 user-facing flows can put a wallet
     * through, and asserts the bookkeeping at each transition. If any
     * stage reverts or balances drift in the wrong direction, the
     * suite fails loud.
     */
    function test_fullLifecycle_createAddSwapRemove() public {
        _requireHook(STABLE_PROTECTION_HOOK);
        IPoolManager manager = IPoolManager(V4_POOL_MANAGER_BASE);

        // ── Stage 1: create the pool. Mirrors PoolCreateForm submit. ──
        manager.initialize(poolKey, SQRT_PRICE_1_1);

        // ── Stage 2: add full-range liquidity. Mirrors AddLiquidityForm. ──
        uint256 usdcBefore = usdcMock.balanceOf(address(this));
        uint256 eurcBefore = eurcMock.balanceOf(address(this));
        int256 liquidityDelta = 100_000e6;
        liqRouter.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: liquidityDelta,
                salt: 0
            }),
            new bytes(0)
        );
        // Adding liquidity sends mUSDC + mEURC into the pool. Balance
        // must drop on both sides (this is a stablecoin pair at 1:1, so
        // both sides contribute roughly the same amount).
        assertLt(usdcMock.balanceOf(address(this)), usdcBefore, "add: mUSDC balance must decrease");
        assertLt(eurcMock.balanceOf(address(this)), eurcBefore, "add: mEURC balance must decrease");

        // ── Stage 3: swap mUSDC → mEURC (zeroForOne). Mirrors swap modal. ──
        uint256 eurcBeforeSwapForward = eurcMock.balanceOf(address(this));
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -1_000e6, // 1000 mUSDC in (exact-input)
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            new bytes(0)
        );
        assertGt(
            eurcMock.balanceOf(address(this)),
            eurcBeforeSwapForward,
            "swap forward: mEURC balance must rise"
        );

        // ── Stage 4: swap back mEURC → mUSDC (oneForZero). ──
        uint256 usdcBeforeSwapBack = usdcMock.balanceOf(address(this));
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -500e6, // 500 mEURC in
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            new bytes(0)
        );
        assertGt(
            usdcMock.balanceOf(address(this)),
            usdcBeforeSwapBack,
            "swap back: mUSDC balance must rise"
        );

        // ── Stage 5: remove half the liquidity. Mirrors RemoveLiquidityModal. ──
        uint256 usdcBeforeRemove = usdcMock.balanceOf(address(this));
        uint256 eurcBeforeRemove = eurcMock.balanceOf(address(this));
        liqRouter.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: -liquidityDelta / 2,
                salt: 0
            }),
            new bytes(0)
        );
        assertGt(
            usdcMock.balanceOf(address(this)),
            usdcBeforeRemove,
            "remove: mUSDC balance must rise (returned from pool)"
        );
        assertGt(
            eurcMock.balanceOf(address(this)),
            eurcBeforeRemove,
            "remove: mEURC balance must rise (returned from pool)"
        );
    }

    /**
     * Same lifecycle but back-to-back inside one test, asserting a
     * fresh pool can absorb a second add → swap cycle on top of the
     * remove from the first cycle. Catches "stale state" regressions
     * the single-pass test can miss.
     */
    function test_fullLifecycle_repeatAddSwapRemove() public {
        _requireHook(STABLE_PROTECTION_HOOK);
        IPoolManager manager = IPoolManager(V4_POOL_MANAGER_BASE);
        manager.initialize(poolKey, SQRT_PRICE_1_1);

        for (uint256 cycle = 0; cycle < 2; cycle++) {
            liqRouter.modifyLiquidity(
                poolKey,
                ModifyLiquidityParams({
                    tickLower: TICK_LOWER,
                    tickUpper: TICK_UPPER,
                    liquidityDelta: 50_000e6,
                    salt: 0
                }),
                new bytes(0)
            );
            uint256 eurcBefore = eurcMock.balanceOf(address(this));
            swapRouter.swap(
                poolKey,
                SwapParams({
                    zeroForOne: true,
                    amountSpecified: -100e6,
                    sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                new bytes(0)
            );
            assertGt(eurcMock.balanceOf(address(this)), eurcBefore, "cycle swap: mEURC must rise");
            liqRouter.modifyLiquidity(
                poolKey,
                ModifyLiquidityParams({
                    tickLower: TICK_LOWER,
                    tickUpper: TICK_UPPER,
                    liquidityDelta: -25_000e6,
                    salt: 0
                }),
                new bytes(0)
            );
        }
    }
}
