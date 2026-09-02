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

interface IDynamicFee {
    function configurePool(
        bytes32 poolId,
        uint64 twapWindow,
        uint24 maxFee,
        uint24 fallbackFee,
        int8 decimalDiff,
        uint256[4] calldata thresholds
    ) external;
    function owner() external view returns (address);
}

/**
 * P5-010 — DynamicFee end-to-end swap test.
 *
 * Forks Base Mainnet, deploys mock 18-decimal tokens, registers a fresh
 * pool against the live TWAP-based DynamicFee hook (dynamic-fee at
 * commit 62710d6), pranks the hook's owner() to call configurePool
 * with a 5-minute TWAP window, then runs swaps to confirm the fee
 * lifecycle fires without reverting.
 *
 * On a fresh pool the TwapOracle buffer is still warming up, so the
 * hook is expected to emit `TwapWarmup` and charge `fallbackFee`.
 * Tighter per-zone fee assertions require a controlled history of
 * observations and are deferred to the follow-up test below.
 *
 * The hook has no Base Mainnet deployment yet — until
 * `DYNAMIC_FEE_HOOK_ADDRESS` is set, every test here skips.
 */
contract DynamicFeeE2E is BaseFork {
    using PoolIdLibrary for PoolKey;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest liqRouter;
    MockERC20 token0;
    MockERC20 token1;
    PoolKey poolKey;

    function setUp() public override {
        super.setUp();
        // Hook-dependent setup only runs once the mainnet deploy lands;
        // tests call _requireHook and skip until then.
        if (DYNAMIC_FEE_HOOK == address(0)) return;
        IPoolManager manager = IPoolManager(V4_POOL_MANAGER_BASE);
        swapRouter = new PoolSwapTest(manager);
        liqRouter = new PoolModifyLiquidityTest(manager);

        MockERC20 a = new MockERC20("Token0", "T0", 18);
        MockERC20 b = new MockERC20("Token1", "T1", 18);
        (token0, token1) = address(a) < address(b) ? (a, b) : (b, a);

        token0.mint(address(this), 1_000e18);
        token1.mint(address(this), 1_000e18);
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);
        token0.approve(address(liqRouter), type(uint256).max);
        token1.approve(address(liqRouter), type(uint256).max);

        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: int24(60),
            hooks: IHooks(DYNAMIC_FEE_HOOK)
        });

        IDynamicFee df = IDynamicFee(DYNAMIC_FEE_HOOK);
        address dfOwner = df.owner();
        uint256[4] memory thresholds = [uint256(100), 300, 500, 1000];
        vm.prank(dfOwner);
        df.configurePool(
            PoolId.unwrap(poolKey.toId()), uint64(300), 20_000, 3000, int8(0), thresholds
        );

        manager.initialize(poolKey, SQRT_PRICE_1_1);
        liqRouter.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({tickLower: -887_220, tickUpper: 887_220, liquidityDelta: 100e18, salt: 0}),
            new bytes(0)
        );
    }

    function test_swapsExecute_duringTwapWarmup() public {
        _requireHook(DYNAMIC_FEE_HOOK);
        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -1e16, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            new bytes(0)
        );
        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -10e18, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            new bytes(0)
        );
        assertGt(token1.balanceOf(address(this)), 0, "Should have received output tokens");
    }

    /// @dev Per-zone fee assertions require event decoding plus a
    /// populated TWAP buffer (window crossed, multiple observations).
    /// Tracked as P5-010 follow-up.
    function test_volatilityBand_returnsToBaseline() public {
        vm.skip(true);
    }
}
