// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: tests for MarketFeeCalculator — the five-premium stack, directional
// adjustment, stale-state behaviour, clamping. Spec §16-§18, §22.
// Covers spec §33 edge cases 5-10, 13, 14 and the §34 fuzz invariant.

import {Test} from "forge-std/Test.sol";
import {MarketFeeCalculator as C} from "../../../src/hooks/dynamic-market/MarketFeeCalculator.sol";
import {RiskPolicy} from "../../../src/hooks/dynamic-market/RiskPolicy.sol";
import {IMarketStateRegistry as I} from "../../../src/hooks/dynamic-market/IMarketStateRegistry.sol";

contract MarketFeeCalculatorTest is Test {
    /// @dev A calm, healthy, fresh market: the baseline every case departs from.
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
            increasesRisk: false
        });
    }

    // ─── Base case (§17.1) ───────────────────────────────────────────────

    function test_calmMarketPaysTheBaseFee() public pure {
        (uint24 fee,) = C.calculate(_calm());
        assertEq(fee, RiskPolicy.BASE_FEE, "no risk means no premium");
    }

    // ─── Each premium raises the fee (§17, §35) ──────────────────────────

    function test_volatilityRaisesTheFee() public pure {
        C.Inputs memory i = _calm();
        (uint24 base,) = C.calculate(i);
        i.volatilityBps = 8000;
        (uint24 high,) = C.calculate(i);
        assertGt(high, base);
    }

    function test_imbalanceRaisesTheFee() public pure {
        C.Inputs memory i = _calm();
        (uint24 base,) = C.calculate(i);
        i.imbalanceBps = 8000;
        (uint24 high,) = C.calculate(i);
        assertGt(high, base);
    }

    function test_lowLiquidityRaisesTheFee() public pure {
        C.Inputs memory i = _calm();
        (uint24 base,) = C.calculate(i);
        i.liquidity = 1;
        (uint24 thin,) = C.calculate(i);
        assertGt(thin, base);
    }

    function test_eventRiskRaisesTheFeeMonotonicallyThroughTheStates() public pure {
        C.Inputs memory i = _calm();
        (uint24 pre,) = C.calculate(i);
        i.eventState = I.EventState.LIVE;
        (uint24 live,) = C.calculate(i);
        i.eventState = I.EventState.CRITICAL;
        (uint24 crit,) = C.calculate(i);
        assertGe(live, pre);
        assertGt(crit, live, "a red card must cost more than an ordinary live tick");
    }

    function test_modelDeviationRaisesTheFee() public pure {
        C.Inputs memory i = _calm();
        (uint24 agreed,) = C.calculate(i);
        i.modelProbBps = 2000; // model disagrees with the market by 30 points
        (uint24 diverged,) = C.calculate(i);
        assertGt(diverged, agreed);
    }

    // ─── Confidence gates the deviation premium (§12) ────────────────────

    function test_lowConfidenceDeviationBarelyMoves() public pure {
        C.Inputs memory i = _calm();
        i.modelProbBps = 2000;
        i.confidenceBps = 10_000;
        (uint24 certain,) = C.calculate(i);
        i.confidenceBps = 500;
        (uint24 unsure,) = C.calculate(i);
        assertLt(unsure, certain, "an unconfident model must not move the fee much");
    }

    function test_zeroConfidenceRemovesTheDeviationPremium() public pure {
        C.Inputs memory i = _calm();
        i.modelProbBps = 0;
        i.confidenceBps = 0;
        (, C.Breakdown memory b) = C.calculate(i);
        assertEq(b.deviationPremium, 0);
    }

    // ─── Directional adjustment (§18) ────────────────────────────────────

    function test_riskIncreasingTradePaysMoreThanRiskReducing() public pure {
        C.Inputs memory i = _calm();
        i.imbalanceBps = 6000;
        i.increasesRisk = false;
        (uint24 reducing,) = C.calculate(i);
        i.increasesRisk = true;
        (uint24 increasing,) = C.calculate(i);
        assertGt(increasing, reducing, "the toxic side pays");
    }

    function test_riskReducingTradeNeverGoesBelowBaseFee() public pure {
        C.Inputs memory i = _calm();
        i.increasesRisk = false;
        (uint24 fee,) = C.calculate(i);
        assertGe(fee, RiskPolicy.BASE_FEE);
    }

    // ─── Stale state (§22; edge cases 13, 14) ────────────────────────────

    function test_staleStateClampsToMaxFee() public pure {
        C.Inputs memory i = _calm();
        i.stale = true;
        (uint24 fee,) = C.calculate(i);
        assertEq(fee, RiskPolicy.MAX_FEE, "fail closed, not fail open");
    }

    function test_staleStateDoesNotRevert() public pure {
        C.Inputs memory i = _calm();
        i.stale = true;
        i.liquidity = 0;
        i.volatilityBps = 10_000;
        C.calculate(i); // must not revert — a stale market stays usable
    }

    function test_staleStateExcludesTheDeviationPremium() public pure {
        C.Inputs memory i = _calm();
        i.modelProbBps = 0;
        i.stale = true;
        (, C.Breakdown memory b) = C.calculate(i);
        assertEq(b.deviationPremium, 0, "a stale model signal must not be priced");
    }

    function test_staleTradeCapIsTheMinimum() public pure {
        C.Inputs memory i = _calm();
        i.stale = true;
        assertEq(C.tradeCap(i), RiskPolicy.MIN_TRADE_CAP);
    }

    // ─── Trade cap (§21) ─────────────────────────────────────────────────

    function test_calmMarketGetsTheAbsoluteMaxCap() public pure {
        assertEq(C.tradeCap(_calm()), RiskPolicy.ABS_MAX_TRADE);
    }

    function test_capShrinksAsRiskRises() public pure {
        C.Inputs memory i = _calm();
        uint256 calm = C.tradeCap(i);
        i.volatilityBps = 9000;
        i.imbalanceBps = 9000;
        uint256 risky = C.tradeCap(i);
        assertLt(risky, calm);
        assertGe(risky, RiskPolicy.MIN_TRADE_CAP);
    }

    function test_zeroLiquidityCapIsTheMinimum() public pure {
        // Edge case 5 — §15 says the cap moves toward its minimum.
        C.Inputs memory i = _calm();
        i.liquidity = 0;
        assertEq(C.tradeCap(i), RiskPolicy.MIN_TRADE_CAP);
    }

    function testFuzz_capAlwaysWithinImmutableBounds(uint16 vol, uint16 imb, uint128 liq, uint8 state, bool stale)
        public
        pure
    {
        C.Inputs memory i = _calm();
        i.volatilityBps = bound(uint256(vol), 0, 10_000);
        i.imbalanceBps = bound(uint256(imb), 0, 10_000);
        i.liquidity = liq;
        i.eventState = I.EventState(bound(uint256(state), 0, 5));
        i.stale = stale;

        uint256 cap = C.tradeCap(i);
        assertGe(cap, RiskPolicy.MIN_TRADE_CAP);
        assertLe(cap, RiskPolicy.ABS_MAX_TRADE);
    }

    // ─── Breakdown for the §29 event ─────────────────────────────────────

    function test_breakdownSumsToTheEffectiveFee() public pure {
        C.Inputs memory i = _calm();
        i.volatilityBps = 4000;
        i.imbalanceBps = 3000;
        i.modelProbBps = 3000;
        i.liquidity = 1000e6;
        i.eventState = I.EventState.LIVE;

        (uint24 fee, C.Breakdown memory b) = C.calculate(i);
        uint256 sum = uint256(b.baseFee) + b.volatilityPremium + b.imbalancePremium + b.liquidityPremium
            + b.eventRiskPremium + b.deviationPremium + b.directionalAdjustment;
        // The published decomposition must explain the published fee, or the
        // UI panel would show premiums that do not add up to what was charged.
        assertEq(RiskPolicy.clampFee(uint24(sum)), fee);
    }

    // ─── The §34 invariant ───────────────────────────────────────────────

    /// @dev The one property that must hold in every reachable state.
    function testFuzz_feeAlwaysWithinImmutableBounds(
        uint16 marketProb,
        uint16 modelProb,
        uint16 conf,
        uint16 vol,
        uint16 imb,
        uint128 liq,
        uint8 state,
        bool stale,
        bool increasesRisk
    ) public pure {
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
        assertGe(fee, RiskPolicy.BASE_FEE);
        assertLe(fee, RiskPolicy.MAX_FEE);
    }
}
