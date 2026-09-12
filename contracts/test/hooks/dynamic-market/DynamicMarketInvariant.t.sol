// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: B2-008 / H-007 invariants and the spec §34 fee fuzz at 100k+ calls.
// The properties: the fee never exceeds MAX_RATE, the playoff rate never
// leaves [MIN_RATE, MAX_RATE], the regular season is free, the per-contract
// fee peaks at even odds, the cap never leaves its band, and no reachable
// state reverts the calculator.

import {Test} from "forge-std/Test.sol";
import {MarketFeeCalculator as C} from "../../../src/hooks/dynamic-market/MarketFeeCalculator.sol";
import {MarketFeeFormula as F} from "../../../src/hooks/dynamic-market/MarketFeeFormula.sol";
import {RiskPolicy} from "../../../src/hooks/dynamic-market/RiskPolicy.sol";
import {IMarketStateRegistry as I} from "../../../src/hooks/dynamic-market/IMarketStateRegistry.sol";

/// @notice Walks the calculator across every reachable market state, recording
///         the extremes it produced so the invariants can check them.
contract FeeHandler is Test {
    uint24 public maxFeeSeen;
    uint24 public minPlayoffRateSeen = type(uint24).max;
    uint24 public maxPlayoffRateSeen;
    uint24 public maxRegularSeasonFeeSeen;
    uint256 public minCapSeen = type(uint256).max;
    uint256 public maxCapSeen;
    uint256 public calls;
    uint256 public peakViolations;

    function exercise(
        uint16 marketProb,
        uint16 modelProb,
        uint16 conf,
        uint16 vol,
        uint16 imb,
        uint128 liq,
        uint8 state,
        bool stale,
        bool increasesRisk,
        bool playoffs
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
            increasesRisk: increasesRisk,
            playoffs: playoffs
        });

        (uint24 fee, C.Breakdown memory b) = C.calculate(i);
        uint256 cap = C.tradeCap(i);

        if (fee > maxFeeSeen) maxFeeSeen = fee;
        if (playoffs) {
            if (b.rate < minPlayoffRateSeen) minPlayoffRateSeen = b.rate;
            if (b.rate > maxPlayoffRateSeen) maxPlayoffRateSeen = b.rate;
            if (F.contractFee(1e12, b.rate, i.marketProbBps) > F.contractFee(1e12, b.rate, 5000)) peakViolations++;
        } else if (fee > maxRegularSeasonFeeSeen) {
            maxRegularSeasonFeeSeen = fee;
        }
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

    /// @notice H-002 / H-006 — the fee never exceeds the immutable ceiling and
    ///         the playoff rate never leaves its band.
    function invariant_feeWithinImmutableBounds() public view {
        if (handler.calls() == 0) return;
        assertLe(handler.maxFeeSeen(), RiskPolicy.MAX_RATE, "fee exceeded MAX_RATE");
        if (handler.maxPlayoffRateSeen() > 0) {
            assertGe(handler.minPlayoffRateSeen(), RiskPolicy.MIN_RATE, "rate fell below MIN_RATE");
            assertLe(handler.maxPlayoffRateSeen(), RiskPolicy.MAX_RATE, "rate exceeded MAX_RATE");
        }
    }

    /// @notice H-004 — the regular season is always free.
    function invariant_regularSeasonIsFree() public view {
        assertEq(handler.maxRegularSeasonFeeSeen(), 0, "a regular-season swap was charged");
    }

    /// @notice H-006 — fee(p = 0.5) ≥ fee(p) for the same conditions.
    function invariant_perContractFeePeaksAtEvenOdds() public view {
        assertEq(handler.peakViolations(), 0, "a price other than 0.50 paid more per contract");
    }

    /// @notice Spec §21 — the cap never leaves its immutable band.
    function invariant_capWithinImmutableBounds() public view {
        if (handler.calls() == 0) return;
        assertGe(handler.minCapSeen(), RiskPolicy.MIN_TRADE_CAP, "cap fell below MIN_TRADE_CAP");
        assertLe(handler.maxCapSeen(), RiskPolicy.ABS_MAX_TRADE, "cap exceeded ABS_MAX_TRADE");
    }

    /// @notice Spec §34 requires at least 100,000 calls. Runs the sweep
    ///         directly so the count is asserted rather than assumed from the
    ///         invariant runner's configuration.
    function test_feeInvariantOverOneHundredThousandCalls() public {
        uint24 hi = 0;
        uint24 loRate = type(uint24).max;
        vm.pauseGasMetering();

        uint256 h = 0x9E3779B97F4A7C15;
        for (uint256 n = 0; n < 100_000; n++) {
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
                increasesRisk: ((h >> 129) & 1) == 1,
                playoffs: ((h >> 130) & 3) != 0 // three in four draws are playoff pools
            });

            (uint24 fee, C.Breakdown memory b) = C.calculate(i);
            uint256 cap = C.tradeCap(i);

            assertLe(fee, RiskPolicy.MAX_RATE);
            if (i.playoffs) {
                assertGe(b.rate, RiskPolicy.MIN_RATE);
                assertLe(b.rate, RiskPolicy.MAX_RATE);
                assertEq(fee, F.effectiveFeePips(b.rate, i.marketProbBps));
                if (b.rate < loRate) loRate = b.rate;
            } else {
                assertEq(fee, 0);
            }
            assertGe(cap, RiskPolicy.MIN_TRADE_CAP);
            assertLe(cap, RiskPolicy.ABS_MAX_TRADE);
            if (fee > hi) hi = fee;
        }

        // The sweep must have exercised the real range: a stale draw at p = 0
        // is the ceiling, and calm draws approach the floor.
        assertEq(hi, RiskPolicy.MAX_RATE, "stale draws at p = 0 must reach the ceiling");
        assertLt(loRate, RiskPolicy.MAX_RATE, "rate must vary across the sweep");
    }
}
