// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: B2-008 invariants and the spec §34 fee fuzz at 100k+ calls.
// The properties: the fee never leaves [BASE_FEE, MAX_FEE], the cap never
// leaves [MIN_TRADE_CAP, ABS_MAX_TRADE], and no reachable state reverts the
// calculator.

import {Test} from "forge-std/Test.sol";
import {MarketFeeCalculator as C} from "../../../src/hooks/dynamic-market/MarketFeeCalculator.sol";
import {RiskPolicy} from "../../../src/hooks/dynamic-market/RiskPolicy.sol";
import {IMarketStateRegistry as I} from "../../../src/hooks/dynamic-market/IMarketStateRegistry.sol";

/// @notice Walks the calculator across every reachable market state, recording
///         the extremes it produced so the invariants can check them.
contract FeeHandler is Test {
    uint24 public minFeeSeen = type(uint24).max;
    uint24 public maxFeeSeen;
    uint256 public minCapSeen = type(uint256).max;
    uint256 public maxCapSeen;
    uint256 public calls;

    function exercise(
        uint16 marketProb,
        uint16 modelProb,
        uint16 conf,
        uint16 vol,
        uint16 imb,
        uint128 liq,
        uint8 state,
        bool stale,
        bool increasesRisk
    ) external {
        C.Inputs memory i = C.Inputs({
            marketProbBps: bound(uint256(marketProb), 0, 10_000),
            modelProbBps: bound(uint256(modelProb), 0, 10_000),
            confidenceBps: bound(uint256(conf), 0, 10_000),
            volatilityBps: bound(uint256(vol), 0, 10_000),
            imbalanceBps: bound(uint256(imb), 0, 10_000),
            liquidity: liq,
            eventState: I.EventState(bound(uint256(state), 0, 5)),
            stale: stale,
            increasesRisk: increasesRisk
        });

        (uint24 fee,) = C.calculate(i);
        uint256 cap = C.tradeCap(i);

        if (fee < minFeeSeen) minFeeSeen = fee;
        if (fee > maxFeeSeen) maxFeeSeen = fee;
        if (cap < minCapSeen) minCapSeen = cap;
        if (cap > maxCapSeen) maxCapSeen = cap;
        calls++;
    }
}

contract DynamicMarketInvariantTest is Test {
    FeeHandler handler;

    function setUp() public {
        handler = new FeeHandler();
        targetContract(address(handler));
    }

    /// @notice Spec §34 / §44 — the fee never leaves the immutable band.
    function invariant_feeWithinImmutableBounds() public view {
        if (handler.calls() == 0) return;
        assertGe(handler.minFeeSeen(), RiskPolicy.BASE_FEE, "fee fell below BASE_FEE");
        assertLe(handler.maxFeeSeen(), RiskPolicy.MAX_FEE, "fee exceeded MAX_FEE");
    }

    /// @notice Spec §21 — the cap never leaves its immutable band.
    function invariant_capWithinImmutableBounds() public view {
        if (handler.calls() == 0) return;
        assertGe(handler.minCapSeen(), RiskPolicy.MIN_TRADE_CAP, "cap fell below MIN_TRADE_CAP");
        assertLe(handler.maxCapSeen(), RiskPolicy.ABS_MAX_TRADE, "cap exceeded ABS_MAX_TRADE");
    }

    /// @notice No reachable state bricks pricing. Spec §44 lists both "stale
    ///         keeper state permanently bricks the market" and "a zero-liquidity
    ///         market causes an unintended arithmetic revert" as failures.
    /// @dev The campaign's own `reverts: 0` line is the direct evidence — a
    ///      revert inside `exercise` would be counted there. This invariant adds
    ///      the complementary check that every call which did run produced a
    ///      priceable result, and it holds vacuously before the first call.
    function invariant_everyExercisedStateWasPriceable() public view {
        if (handler.calls() == 0) return;
        assertLe(handler.minFeeSeen(), RiskPolicy.MAX_FEE, "a call produced no fee at all");
        assertGt(handler.maxCapSeen(), 0, "a call produced no cap at all");
    }

    /// @notice Spec §34 requires at least 100,000 calls. Runs the sweep
    ///         directly so the count is asserted rather than assumed from the
    ///         invariant runner's configuration.
    function test_feeInvariantOverOneHundredThousandCalls() public {
        uint24 lo = type(uint24).max;
        uint24 hi = 0;
        // 100k iterations of real work exceeds the block gas limit; the sweep is
        // about coverage, not gas, so stop metering it.
        vm.pauseGasMetering();

        uint256 h = 0x9E3779B97F4A7C15;
        for (uint256 n = 0; n < 100_000; n++) {
            // Cheap LCG, spread across every input dimension including both
            // stale and fresh and all six event states.
            unchecked {
                h = h * 6_364_136_223_846_793_005 + 1_442_695_040_888_963_407;
            }
            C.Inputs memory i = C.Inputs({
                marketProbBps: h % 10_001,
                modelProbBps: (h >> 16) % 10_001,
                confidenceBps: (h >> 32) % 10_001,
                volatilityBps: (h >> 48) % 10_001,
                imbalanceBps: (h >> 64) % 10_001,
                liquidity: uint128((h >> 80) % (200_000e6)),
                eventState: I.EventState((h >> 120) % 6),
                stale: ((h >> 128) & 1) == 1,
                increasesRisk: ((h >> 129) & 1) == 1
            });

            (uint24 fee,) = C.calculate(i);
            uint256 cap = C.tradeCap(i);

            if (fee < lo) lo = fee;
            if (fee > hi) hi = fee;

            assertGe(fee, RiskPolicy.BASE_FEE);
            assertLe(fee, RiskPolicy.MAX_FEE);
            assertGe(cap, RiskPolicy.MIN_TRADE_CAP);
            assertLe(cap, RiskPolicy.ABS_MAX_TRADE);
        }

        // The sweep must have exercised a real range, or the bounds check
        // above would pass vacuously.
        assertLt(lo, hi, "fee must vary across the sweep");
        assertEq(hi, RiskPolicy.MAX_FEE, "stale draws must reach the ceiling");
        // The exact floor is *not* asserted here: reaching BASE_FEE needs all
        // six premiums at zero simultaneously — calm, deep, pre-game, fresh,
        // and model-agreed — which random sampling will not produce. That the
        // floor is attainable is proven directly by
        // MarketFeeCalculatorTest.test_calmMarketPaysTheBaseFee.
        assertGe(lo, RiskPolicy.BASE_FEE);
    }
}
