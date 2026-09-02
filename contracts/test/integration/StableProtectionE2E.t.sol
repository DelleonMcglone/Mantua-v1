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
import {MockERC20} from "solmate/test/utils/mocks/MockERC20.sol"; // resolved via remappings (solmate/=lib/solmate/src/)

/**
 * P5-006 — Stable Protection happy-path swap test.
 *
 * Forks Base Mainnet, deploys two mock 6-decimal stablecoins, initializes
 * a fresh USDC/EURC-style pool that points at the live StableProtectionHook,
 * seeds liquidity at 1:1, then executes a small swap.
 *
 * The hook gates initialization (BEFORE_INITIALIZE) and rewrites the fee
 * on every swap (BEFORE_SWAP). If the lifecycle is wired correctly the
 * test passes; if either stage reverts, we surface a clean failure.
 *
 * The hook has no Base Mainnet deployment yet — until
 * `STABLE_PROTECTION_HOOK_ADDRESS` is set, every test here skips.
 */
contract StableProtectionE2E is BaseFork {
    using PoolIdLibrary for PoolKey;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

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

        // Two 6-decimal stablecoin mocks (matches USDC/EURC on Base).
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
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: int24(60),
            hooks: IHooks(STABLE_PROTECTION_HOOK)
        });

        manager.initialize(poolKey, SQRT_PRICE_1_1);
        liqRouter.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: -887_220, tickUpper: 887_220, liquidityDelta: 100_000e6, salt: 0}),
            new bytes(0)
        );
    }

    function test_pegHealthy_swapApplied() public {
        _requireHook(STABLE_PROTECTION_HOOK);
        uint256 balanceBefore = eurcMock.balanceOf(address(this));
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -1000e6, // 1000 mUSDC in
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            new bytes(0)
        );
        uint256 balanceAfter = eurcMock.balanceOf(address(this));
        assertGt(balanceAfter, balanceBefore, "Swap should yield mEURC at peg parity");
    }

    /// @dev CRITICAL-zone block: needs the pool driven into a deep depeg
    /// state, which on a fresh forked pool means very large directional
    /// trades against shallow liquidity. Tracked under P5-006 follow-up.
    function test_pegCritical_swapBlocked() public {
        vm.skip(true);
    }
}
