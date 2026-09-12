// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: tests for MarketFeeCalculator — the four-driver dynamic rate, the
// D-105 season gate, the p × (1 − p) shaping, stale behaviour, clamping, and
// the trade cap. Task 049: H-003, H-004, H-006. Spec §33 edge cases 5-10, 13, 14.

import {Test} from "forge-std/Test.sol";
import {MarketFeeCalculator as C} from "../../../src/hooks/dynamic-market/MarketFeeCalculator.sol";
import {MarketFeeFormula as F} from "../../../src/hooks/dynamic-market/MarketFeeFormula.sol";
import {RiskPolicy} from "../../../src/hooks/dynamic-market/RiskPolicy.sol";
import {IMarketStateRegistry as I} from "../../../src/hooks/dynamic-market/IMarketStateRegistry.sol";

contract MarketFeeCalculatorTest is Test {
    /// @dev A calm, deep, agreed, fresh playoff market at even odds: the
    ///      baseline every case departs from. Pays exactly MIN_RATE.
    function _calm() internal pure returns (C.Inputs memory) {
        return C.Inputs({
            marketProbBps: 5000,
            modelProbBps: 5000,
            confidenceBps: 8000,
            volatilityBps: 0,
            imbalanceBps: 0,
            liquidity: 1_000_000e6,
            eventState: I.EventState.PRE_GAME,
            stale: false,
            increasesRisk: false,
            playoffs: true
        });
    }

    function _rate(C.Inputs memory i) internal pure returns (uint24) {
        return C.rate(i).rate;
    }

    // ─── Season gate (H-004) ─────────────────────────────────────────────

    function test_regularSeasonIsFreeWhateverTheConditions() public pure {
        C.Inputs memory i = _calm();
        i.playoffs = false;
        i.liquidity = 0;
        i.volatilityBps = 10_000;
        i.imbalanceBps = 10_000;
        i.stale = true;
        i.eventState = I.EventState.CRITICAL;
        (uint24 fee, C.Breakdown memory b) = C.calculate(i);
        assertEq(fee, RiskPolicy.REGULAR_SEASON_FEE);
        assertEq(b.rate, 0);
        assertEq(b.minRate, 0);
        assertFalse(b.playoffs);
    }

    function test_playoffsActivateTheDynamicRate() public pure {
        (uint24 fee, C.Breakdown memory b) = C.calculate(_calm());
        assertEq(b.rate, RiskPolicy.MIN_RATE, "no risk means the floor rate");
        assertEq(fee, F.effectiveFeePips(RiskPolicy.MIN_RATE, 5000), "50/50 charges half the rate on the input");
        assertTrue(b.playoffs);
    }

    // ─── Each driver raises the rate (H-003) ─────────────────────────────

    function test_lowLiquidityRaisesTheRate() public pure {
        C.Inputs memory i = _calm();
        i.liquidity = 1;
        assertGt(_rate(i), RiskPolicy.MIN_RATE);
    }

    function test_volatilityRaisesTheRate() public pure {
        C.Inputs memory i = _calm();
        i.volatilityBps = 8000;
        assertGt(_rate(i), RiskPolicy.MIN_RATE);
    }

    function test_activityRaisesTheRateAndTheToxicSidePaysMore() public pure {
        C.Inputs memory i = _calm();
        i.imbalanceBps = 6000;
        uint24 reducing = _rate(i);
        assertGt(reducing, RiskPolicy.MIN_RATE);
        i.increasesRisk = true;
        assertGt(_rate(i), reducing, "the toxic side pays");
    }

    function test_uncertaintyRaisesTheRate() public pure {
        C.Inputs memory i = _calm();
        i.modelProbBps = 2000; // model disagrees with the market by 30 points
        uint24 diverged = _rate(i);
        assertGt(diverged, RiskPolicy.MIN_RATE);
        i.eventState = I.EventState.LIVE;
        uint24 live = _rate(i);
        assertGt(live, diverged);
        i.eventState = I.EventState.CRITICAL;
        assertGt(_rate(i), live, "a red card must cost more than an ordinary live tick");
    }

    function test_confidenceGatesTheDeviationTerm() public pure {
        C.Inputs memory i = _calm();
        i.modelProbBps = 2000;
        i.confidenceBps = 10_000;
        uint24 certain = _rate(i);
        i.confidenceBps = 500;
        assertLt(_rate(i), certain, "an unconfident model must not move the rate much");
        i.confidenceBps = 0;
        assertEq(C.rate(i).uncertaintyPremium, 0);
    }

    // ─── Band edges are reachable exactly (H-015) ────────────────────────

    function test_everyDriverAtMaximumLandsExactlyOnTheCeiling() public pure {
        C.Inputs memory i = _calm();
        i.liquidity = 0;
        i.volatilityBps = 10_000;
        i.imbalanceBps = 10_000;
        i.increasesRisk = true;
        i.modelProbBps = 0;
        i.marketProbBps = 10_000;
        i.confidenceBps = 10_000;
        i.eventState = I.EventState.CRITICAL;
        C.Breakdown memory b = C.rate(i);
        assertEq(b.rate, RiskPolicy.MAX_RATE);
        assertEq(
            uint256(b.minRate) + b.liquidityPremium + b.volatilityPremium + b.activityPremium + b.uncertaintyPremium,
            RiskPolicy.MAX_RATE
        );
    }

    // ─── Stale state (§22; edge cases 13, 14) ────────────────────────────

    function test_staleStateClampsToTheCeilingWithoutReverting() public pure {
        C.Inputs memory i = _calm();
        i.stale = true;
        i.liquidity = 0;
        i.volatilityBps = 10_000;
        (uint24 fee, C.Breakdown memory b) = C.calculate(i);
        assertEq(b.rate, RiskPolicy.MAX_RATE, "fail closed, not fail open");
        assertEq(fee, F.effectiveFeePips(RiskPolicy.MAX_RATE, 5000));
        assertTrue(b.stale);
        assertEq(b.uncertaintyPremium, 0, "a stale model signal must not be priced");
        assertEq(C.tradeCap(i), RiskPolicy.MIN_TRADE_CAP);
    }

    // ─── Price shaping (H-005, H-006) ────────────────────────────────────

    function test_feeFollowsTheProbabilityReadFromThePool() public pure {
        C.Inputs memory i = _calm();
        i.marketProbBps = 2500;
        (uint24 lowP,) = C.calculate(i);
        i.marketProbBps = 7500;
        (uint24 highP,) = C.calculate(i);
        // Rate is MIN_RATE in both (deviation from the 5000 model is symmetric),
        // so the pip fee is rate × (1 − p): higher at low p, lower at high p.
        assertEq(lowP, F.effectiveFeePips(_rate(i), 2500));
        assertEq(highP, F.effectiveFeePips(_rate(i), 7500));
        assertGt(lowP, highP);
    }

    // ─── Trade cap (§21) ─────────────────────────────────────────────────

    function test_calmMarketGetsTheAbsoluteMaxCap() public pure {
        assertEq(C.tradeCap(_calm()), RiskPolicy.ABS_MAX_TRADE);
    }

    function test_capShrinksAsRiskRisesAndIsSeasonIndependent() public pure {
        C.Inputs memory i = _calm();
        i.volatilityBps = 9000;
        i.imbalanceBps = 9000;
        uint256 risky = C.tradeCap(i);
        assertLt(risky, RiskPolicy.ABS_MAX_TRADE);
        assertGe(risky, RiskPolicy.MIN_TRADE_CAP);
        i.playoffs = false;
        assertEq(C.tradeCap(i), risky, "the cap is a risk control, not a fee");
    }

    function test_zeroLiquidityCapIsTheMinimum() public pure {
        C.Inputs memory i = _calm();
        i.liquidity = 0;
        assertEq(C.tradeCap(i), RiskPolicy.MIN_TRADE_CAP);
    }

    // ─── Breakdown for the §29 event ─────────────────────────────────────

    function test_breakdownExplainsTheRateAndTheFee() public pure {
        C.Inputs memory i = _calm();
        i.volatilityBps = 4000;
        i.imbalanceBps = 3000;
        i.modelProbBps = 3000;
        i.liquidity = 1000e6;
        i.eventState = I.EventState.LIVE;
        i.marketProbBps = 6200;
        (uint24 fee, C.Breakdown memory b) = C.calculate(i);
        uint256 sum =
            uint256(b.minRate) + b.liquidityPremium + b.volatilityPremium + b.activityPremium + b.uncertaintyPremium;
        assertEq(RiskPolicy.clampRate(uint24(sum)), b.rate, "the drivers must add up to the rate");
        assertEq(b.probabilityBps, 6200);
        assertEq(fee, F.effectiveFeePips(b.rate, 6200), "the fee must be the rate shaped by p");
    }

    // ─── Property tests (H-006, H-007) ───────────────────────────────────

    function _any(
        uint16 mp,
        uint16 mo,
        uint16 cf,
        uint16 vol,
        uint16 imb,
        uint128 liq,
        uint8 st,
        bool stale,
        bool inc,
        bool po
    ) internal pure returns (C.Inputs memory) {
        return C.Inputs({
            marketProbBps: bound(uint256(mp), 0, 10_000),
            modelProbBps: bound(uint256(mo), 0, 10_000),
            confidenceBps: bound(uint256(cf), 0, 10_000),
            volatilityBps: bound(uint256(vol), 0, 10_000),
            imbalanceBps: bound(uint256(imb), 0, 10_000),
            liquidity: liq,
            eventState: I.EventState(bound(uint256(st), 0, 5)),
            stale: stale,
            increasesRisk: inc,
            playoffs: po
        });
    }

    /// @dev The one property that must hold in every reachable state: the
    ///      fee never exceeds the ceiling, the playoff rate never leaves its
    ///      band, and the regular season is free.
    function testFuzz_feeNeverExceedsTheCeilingAndTheSeasonRuleHolds(
        uint16 mp,
        uint16 mo,
        uint16 cf,
        uint16 vol,
        uint16 imb,
        uint128 liq,
        uint8 st,
        bool stale,
        bool inc,
        bool po
    ) public pure {
        (uint24 fee, C.Breakdown memory b) = C.calculate(_any(mp, mo, cf, vol, imb, liq, st, stale, inc, po));
        assertLe(fee, RiskPolicy.MAX_RATE);
        if (po) {
            assertGe(b.rate, RiskPolicy.MIN_RATE);
            assertLe(b.rate, RiskPolicy.MAX_RATE);
        } else {
            assertEq(fee, 0);
            assertEq(b.rate, 0);
        }
    }

    /// @dev fee(p = 0.5) ≥ fee(p) per contract, for the same conditions.
    function testFuzz_perContractFeePeaksAtEvenOddsForFixedConditions(
        uint16 mp,
        uint16 mo,
        uint16 cf,
        uint16 vol,
        uint16 imb,
        uint128 liq,
        uint8 st,
        bool stale,
        bool inc
    ) public pure {
        C.Inputs memory i = _any(mp, mo, cf, vol, imb, liq, st, stale, inc, true);
        uint24 r = _rate(i);
        uint256 atHalf = F.contractFee(1e12, r, 5000);
        uint256 atP = F.contractFee(1e12, r, i.marketProbBps);
        assertGe(atHalf, atP);
        // Monotone toward the extremes: nudging p away from 0.50 never raises it.
        uint256 away = i.marketProbBps < 5000
            ? i.marketProbBps - (i.marketProbBps > 0 ? 1 : 0)
            : i.marketProbBps + (i.marketProbBps < 10_000 ? 1 : 0);
        assertGe(atP, F.contractFee(1e12, r, away));
    }

    function testFuzz_capAlwaysWithinImmutableBounds(uint16 vol, uint16 imb, uint128 liq, uint8 state, bool stale)
        public
        pure
    {
        uint256 cap = C.tradeCap(_any(5000, 5000, 8000, vol, imb, liq, state, stale, false, true));
        assertGe(cap, RiskPolicy.MIN_TRADE_CAP);
        assertLe(cap, RiskPolicy.ABS_MAX_TRADE);
    }
}
