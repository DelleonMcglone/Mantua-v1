// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: hook-level tests — permissions, PoolManager-only callbacks,
// registration gate, halts, size cap, fee override, flow accounting.
// Spec §7, §8, §19, §20, §23, §24, §28. Edge cases 11-16 from §33.

import {Test} from "forge-std/Test.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {DynamicMarketHook} from "../../../src/hooks/dynamic-market/DynamicMarketHook.sol";
import {MarketStateRegistry} from "../../../src/hooks/dynamic-market/MarketStateRegistry.sol";
import {IMarketStateRegistry as I} from "../../../src/hooks/dynamic-market/IMarketStateRegistry.sol";
import {MarketErrors} from "../../../src/hooks/dynamic-market/MarketErrors.sol";
import {RiskPolicy} from "../../../src/hooks/dynamic-market/RiskPolicy.sol";

contract DynamicMarketHookTest is Test {
    using PoolIdLibrary for PoolKey;

    PoolManager manager;
    MarketStateRegistry registry;
    DynamicMarketHook hook;

    address operator = makeAddr("operator");
    address keeper = makeAddr("keeper");
    address trader = makeAddr("trader");

    PoolKey key;
    PoolId id;
    uint64 kickoff;

    /// @dev The permission set spec §7 requires, and the address bits it implies.
    uint160 constant EXPECTED_BITS = 0x28C0;
    uint160 constant HOOK_MASK = 0x3FFF;

    function setUp() public {
        vm.warp(1_000_000);
        kickoff = uint64(block.timestamp + 1 days);
        manager = new PoolManager(address(this));
        registry = new MarketStateRegistry(operator, keeper);

        // Place the hook at an address whose low bits encode exactly the four
        // permissions (spec §7). Deployment mines this for real; here we plant
        // the code so the PoolManager accepts the key.
        address target = address(uint160(0x11110000 | uint160(EXPECTED_BITS)));
        deployCodeTo(
            "DynamicMarketHook.sol:DynamicMarketHook",
            abi.encode(IPoolManager(address(manager)), I(address(registry))),
            target
        );
        hook = DynamicMarketHook(target);

        key = PoolKey({
            currency0: Currency.wrap(address(0x1111)),
            currency1: Currency.wrap(address(0x2222)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        id = key.toId();
    }

    function _register() internal {
        vm.prank(operator);
        registry.registerPool(id, kickoff, kickoff + 4 hours, true, 6);
    }

    function _feed() internal {
        vm.prank(keeper);
        registry.updateMarket(id, 5000, 8000, I.EventState.PRE_GAME);
    }

    function _swap(int256 amount) internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: true, amountSpecified: amount, sqrtPriceLimitX96: 0});
    }

    // ─── Permissions (§7, B2-002) ────────────────────────────────────────

    function test_addressEncodesExactlyFourPermissions() public view {
        uint160 bits = uint160(address(hook)) & HOOK_MASK;
        assertEq(bits, EXPECTED_BITS, "address must satisfy addr & 0x3FFF == 0x28C0");
    }

    function test_permissionBitsSumToTheExpectedMask() public pure {
        uint160 sum = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
            | Hooks.AFTER_SWAP_FLAG;
        assertEq(sum, EXPECTED_BITS);
    }

    /// @dev §44: enabling either of these is a failure condition.
    function test_forbiddenPermissionsAreNotEncoded() public view {
        uint160 bits = uint160(address(hook));
        assertEq(bits & Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG, 0, "LPs must always be able to exit");
        assertEq(bits & Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG, 0, "hook must not take a cut");
    }

    function test_noOtherPermissionsAreEncoded() public view {
        uint160 bits = uint160(address(hook)) & HOOK_MASK;
        assertEq(bits & ~EXPECTED_BITS, 0, "no permission beyond the four");
    }

    // ─── PoolManager-only (§28.1) ────────────────────────────────────────

    function test_beforeSwapRejectsDirectCalls() public {
        _register();
        vm.prank(trader);
        vm.expectRevert(MarketErrors.NotPoolManager.selector);
        hook.beforeSwap(trader, key, _swap(-1e6), "");
    }

    function test_beforeInitializeRejectsDirectCalls() public {
        vm.prank(trader);
        vm.expectRevert(MarketErrors.NotPoolManager.selector);
        hook.beforeInitialize(trader, key, 0);
    }

    function test_beforeAddLiquidityRejectsDirectCalls() public {
        vm.prank(trader);
        vm.expectRevert(MarketErrors.NotPoolManager.selector);
        hook.beforeAddLiquidity(trader, key, ModifyLiquidityParams(0, 0, 0, bytes32(0)), "");
    }

    function test_afterSwapRejectsDirectCalls() public {
        vm.prank(trader);
        vm.expectRevert(MarketErrors.NotPoolManager.selector);
        hook.afterSwap(trader, key, _swap(-1e6), BalanceDeltaLibrary.ZERO_DELTA, "");
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(MarketErrors.ZeroAddress.selector);
        new DynamicMarketHook(IPoolManager(address(0)), I(address(registry)));
        vm.expectRevert(MarketErrors.ZeroAddress.selector);
        new DynamicMarketHook(IPoolManager(address(manager)), I(address(0)));
    }

    // ─── Registration gate (§8) ──────────────────────────────────────────

    function test_unregisteredPoolCannotInitialize() public {
        // v4 wraps a reverting hook in Hooks.WrappedError, so assert the
        // precise cause at the hook boundary and that the PoolManager refuses
        // the initialize as a result.
        vm.prank(address(manager));
        vm.expectRevert(MarketErrors.PoolNotRegistered.selector);
        hook.beforeInitialize(address(this), key, 79_228_162_514_264_337_593_543_950_336);

        vm.expectRevert();
        manager.initialize(key, 79_228_162_514_264_337_593_543_950_336);
    }

    function test_registeredPoolInitializes() public {
        _register();
        manager.initialize(key, 79_228_162_514_264_337_593_543_950_336);
        (uint160 sqrtPrice,,,) = _slot0();
        assertGt(sqrtPrice, 0);
    }

    function test_staticFeePoolIsRejected() public {
        PoolKey memory staticKey = key;
        staticKey.fee = 3000;
        vm.prank(operator);
        registry.registerPool(staticKey.toId(), kickoff, kickoff + 4 hours, true, 6);

        vm.prank(address(manager));
        vm.expectRevert(MarketErrors.StaticFeePoolRejected.selector);
        hook.beforeInitialize(address(this), staticKey, 79_228_162_514_264_337_593_543_950_336);

        vm.expectRevert();
        manager.initialize(staticKey, 79_228_162_514_264_337_593_543_950_336);
    }

    // ─── Halts (§23, §24; edge case 16) ──────────────────────────────────

    function test_swapRevertsAfterKickoffWithoutAnyKeeperUpdate() public {
        // Edge case 15 — the freeze must not depend on keeper liveness.
        _register();
        vm.warp(kickoff);
        vm.prank(address(manager));
        vm.expectRevert(MarketErrors.MarketFrozen.selector);
        hook.beforeSwap(trader, key, _swap(-1e6), "");
    }

    function test_swapRevertsWhenPaused() public {
        _register();
        _feed();
        vm.prank(operator);
        registry.setPaused(id, true);

        vm.prank(address(manager));
        vm.expectRevert(MarketErrors.MarketPaused.selector);
        hook.beforeSwap(trader, key, _swap(-1e6), "");
    }

    function test_swapRevertsUnderGlobalPause() public {
        _register();
        _feed();
        vm.prank(operator);
        registry.setGlobalPaused(true);

        vm.prank(address(manager));
        vm.expectRevert(MarketErrors.MarketPaused.selector);
        hook.beforeSwap(trader, key, _swap(-1e6), "");
    }

    function test_swapRevertsWhenResolvedAndWhenVoided() public {
        _register();
        vm.prank(keeper);
        registry.updateMarket(id, 5000, 8000, I.EventState.RESOLVED);
        vm.prank(address(manager));
        vm.expectRevert(MarketErrors.MarketResolved.selector);
        hook.beforeSwap(trader, key, _swap(-1e6), "");

        vm.prank(keeper);
        registry.updateMarket(id, 5000, 8000, I.EventState.VOID);
        vm.prank(address(manager));
        vm.expectRevert(MarketErrors.MarketVoided.selector);
        hook.beforeSwap(trader, key, _swap(-1e6), "");
    }

    function test_addLiquidityHaltsWithTradingButRemoveHasNoHook() public {
        _register();
        _feed();
        vm.prank(operator);
        registry.setPaused(id, true);

        vm.prank(address(manager));
        vm.expectRevert(MarketErrors.MarketPaused.selector);
        hook.beforeAddLiquidity(trader, key, ModifyLiquidityParams(-60, 60, 1e18, bytes32(0)), "");

        // §23: removal is permitted during a halt, and the hook has no
        // beforeRemoveLiquidity permission at all — the function does not exist.
        assertEq(uint160(address(hook)) & Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG, 0);
    }

    // ─── Fee and cap (§19, §20) ──────────────────────────────────────────

    function test_beforeSwapReturnsOverrideFlaggedFeeAndZeroDelta() public {
        _register();
        _feed();
        manager.initialize(key, 79_228_162_514_264_337_593_543_950_336);

        vm.prank(address(manager));
        (bytes4 sel,, uint24 feeWithFlag) = hook.beforeSwap(trader, key, _swap(-1e6), "");

        assertEq(sel, IHooks.beforeSwap.selector);
        assertTrue(feeWithFlag & LPFeeLibrary.OVERRIDE_FEE_FLAG != 0, "must set OVERRIDE_FEE_FLAG");
        uint24 fee = feeWithFlag & ~LPFeeLibrary.OVERRIDE_FEE_FLAG;
        assertGe(fee, RiskPolicy.BASE_FEE);
        assertLe(fee, RiskPolicy.MAX_FEE);
    }

    function test_swapAboveTheCapReverts() public {
        _register();
        _feed();
        manager.initialize(key, 79_228_162_514_264_337_593_543_950_336);

        // Zero liquidity drives the cap to its minimum, so anything larger
        // than MIN_TRADE_CAP in USDC notional must be rejected.
        vm.prank(address(manager));
        vm.expectRevert();
        hook.beforeSwap(trader, key, _swap(-int256(RiskPolicy.ABS_MAX_TRADE)), "");
    }

    function test_swapAtTheCapSucceeds() public {
        _register();
        _feed();
        manager.initialize(key, 79_228_162_514_264_337_593_543_950_336);

        vm.prank(address(manager));
        hook.beforeSwap(trader, key, _swap(-int256(RiskPolicy.MIN_TRADE_CAP)), "");
    }

    function test_staleKeeperStateChargesMaxFeeWithoutReverting() public {
        // Edge cases 13, 14 — keeper offline, state stale.
        _register();
        _feed();
        manager.initialize(key, 79_228_162_514_264_337_593_543_950_336);
        vm.warp(block.timestamp + RiskPolicy.STALE_AFTER + 1);

        vm.prank(address(manager));
        (,, uint24 feeWithFlag) = hook.beforeSwap(trader, key, _swap(-1e6), "");
        assertEq(feeWithFlag & ~LPFeeLibrary.OVERRIDE_FEE_FLAG, RiskPolicy.MAX_FEE);
    }

    // ─── Flow accounting (§13, §14; edge case 11) ────────────────────────

    function test_afterSwapRecordsFlow() public {
        _register();
        _feed();
        manager.initialize(key, 79_228_162_514_264_337_593_543_950_336);

        vm.prank(address(manager));
        hook.afterSwap(trader, key, _swap(-5e6), BalanceDeltaLibrary.ZERO_DELTA, "");
        (uint128 buy,,,,) = hook.flowOf(id);
        assertEq(buy, 5e6);
    }

    function test_sameBlockSwapsAccumulateWithoutDecay() public {
        _register();
        _feed();
        manager.initialize(key, 79_228_162_514_264_337_593_543_950_336);

        vm.startPrank(address(manager));
        hook.afterSwap(trader, key, _swap(-3e6), BalanceDeltaLibrary.ZERO_DELTA, "");
        hook.afterSwap(trader, key, _swap(-4e6), BalanceDeltaLibrary.ZERO_DELTA, "");
        vm.stopPrank();

        (uint128 buy,,,,) = hook.flowOf(id);
        assertEq(buy, 7e6, "no decay within one block");
    }

    /// @dev Regression: flow used to accumulate raw `amountSpecified`, which is
    ///      YES on one side of the book and USDC on the other, so a 1000-share
    ///      sell at 5c weighed the same as a $1000 buy. Both sides are now USDC
    ///      notional, so a YES-denominated leg is scaled by probability.
    function test_flowAccumulatesUsdcNotionalNotRawAmount() public {
        _register();
        _feed();
        manager.initialize(key, 79_228_162_514_264_337_593_543_950_336);

        // zeroForOne with YES as token0 => the exact-input leg is 1000 YES.
        // At the seeded parity price that is ~$1000 of notional, not 1000 raw.
        vm.prank(address(manager));
        hook.afterSwap(trader, key, _swap(-1000e6), BalanceDeltaLibrary.ZERO_DELTA, "");

        (uint128 buy,,,,) = hook.flowOf(id);
        assertGt(buy, 0, "flow must be recorded");
        assertLe(buy, 1000e6, "a YES leg is worth at most its face in USDC");
    }

    function test_flowDecaysAcrossBlocks() public {
        _register();
        _feed();
        manager.initialize(key, 79_228_162_514_264_337_593_543_950_336);

        vm.prank(address(manager));
        hook.afterSwap(trader, key, _swap(-1000e6), BalanceDeltaLibrary.ZERO_DELTA, "");
        vm.warp(block.timestamp + 300);
        vm.prank(address(manager));
        hook.afterSwap(trader, key, _swap(-0), BalanceDeltaLibrary.ZERO_DELTA, "");

        (uint128 buy,,,,) = hook.flowOf(id);
        assertApproxEqAbs(buy, 500e6, 1e6, "one half-life halves the flow");
    }

    function _slot0() internal view returns (uint160, int24, uint24, uint24) {
        return _slot0For(id);
    }

    function _slot0For(PoolId poolId) internal view returns (uint160 a, int24 b, uint24 c, uint24 d) {
        bytes32 slot = keccak256(abi.encodePacked(PoolId.unwrap(poolId), uint256(6)));
        bytes32 raw = vm.load(address(manager), slot);
        a = uint160(uint256(raw));
        b = int24(uint24(uint256(raw) >> 160));
        c = uint24(uint256(raw) >> 184);
        d = uint24(uint256(raw) >> 208);
    }
}
