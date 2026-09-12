// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: the H-013 / H-015 scenario matrix — every fee-model claim checked
// across p = 0 … 100% (including 5/25/50/75/95) under calm, thin, volatile,
// one-sided, uncertain, stale, all-max, and regular-season conditions, plus
// the trade-size extremes. Logs the table the fee-model docs quote.

import {Test, console2} from "forge-std/Test.sol";
import {MarketFeeCalculator as C} from "../../../src/hooks/dynamic-market/MarketFeeCalculator.sol";
import {MarketFeeFormula as F} from "../../../src/hooks/dynamic-market/MarketFeeFormula.sol";
import {RiskPolicy} from "../../../src/hooks/dynamic-market/RiskPolicy.sol";
import {IMarketStateRegistry as I} from "../../../src/hooks/dynamic-market/IMarketStateRegistry.sol";

contract FeeScenariosTest is Test {
    uint256 constant BPS = 10_000;

    function _probs() internal pure returns (uint16[10] memory) {
        return [0, 500, 1000, 2500, 5000, 7500, 9000, 9500, 9999, 10_000];
    }

    /// @dev Named market conditions. Index 0 is calm; 6 is every driver at max.
    function _scenario(uint256 n) internal pure returns (string memory name, C.Inputs memory i) {
        i = C.Inputs({
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
        if (n == 0) return ("calm / deep / pre-game", i);
        if (n == 1) {
            i.liquidity = 0;
            return ("zero liquidity", i);
        }
        if (n == 2) {
            i.volatilityBps = BPS;
            return ("maximum volatility", i);
        }
        if (n == 3) {
            i.imbalanceBps = BPS;
            i.increasesRisk = true;
            return ("one-sided flow, toxic side", i);
        }
        if (n == 4) {
            i.modelProbBps = 0;
            i.confidenceBps = BPS;
            i.eventState = I.EventState.CRITICAL;
            return ("model disagrees, critical moment", i);
        }
        if (n == 5) {
            i.stale = true;
            return ("stale keeper", i);
        }
        if (n == 6) {
            i.liquidity = 0;
            i.volatilityBps = BPS;
            i.imbalanceBps = BPS;
            i.increasesRisk = true;
            i.modelProbBps = 0;
            i.confidenceBps = BPS;
            i.eventState = I.EventState.CRITICAL;
            return ("every driver at maximum", i);
        }
        i.playoffs = false;
        i.liquidity = 0;
        i.volatilityBps = BPS;
        i.stale = true;
        return ("regular season (stale and thin)", i);
    }

    /// @notice The matrix: bounds, shaping, and the reachable extremes.
    function test_scenarioMatrix() public pure {
        uint16[10] memory probs = _probs();
        for (uint256 n = 0; n < 8; n++) {
            (string memory name, C.Inputs memory base) = _scenario(n);
            uint256 peak;
            uint24 rateAtHalf;
            uint24 maxRate;
            for (uint256 k = 0; k < probs.length; k++) {
                C.Inputs memory i = base;
                i.marketProbBps = probs[k];
                // Model deviation depends on p; pin the model to the market for
                // the uncertainty scenarios so the rate is constant across p.
                if (n == 4 || n == 6) i.modelProbBps = probs[k] >= 5000 ? 0 : BPS;
                (uint24 fee, C.Breakdown memory b) = C.calculate(i);
                uint256 perHundred = F.contractFee(100e6, b.rate, probs[k]);
                console2.log(name, probs[k], b.rate, fee);
                console2.log("  fee for 100 contracts (USDC raw):", perHundred);

                assertLe(fee, RiskPolicy.MAX_RATE, "ceiling");
                assertEq(fee, F.effectiveFeePips(b.rate, probs[k]), "fee is the rate shaped by 1 - p");
                if (!base.playoffs) {
                    assertEq(fee, 0, "regular season is free");
                    continue;
                }
                assertGe(b.rate, RiskPolicy.MIN_RATE, "floor");
                if (probs[k] == 5000) rateAtHalf = b.rate;
                if (b.rate > maxRate) maxRate = b.rate;
                if (perHundred > peak) peak = perHundred;
            }
            if (!base.playoffs) continue;
            assertEq(peak, F.contractFee(100e6, rateAtHalf, 5000), "50/50 pays the most per contract");
            if (n == 0) assertEq(rateAtHalf, RiskPolicy.MIN_RATE, "calm market pays exactly 0.10%");
            if (n == 5) assertEq(rateAtHalf, RiskPolicy.MAX_RATE, "stale pays exactly 0.70% at every p");
            // The model-deviation driver needs the widest gap (market at 0 or
            // 1 against the opposite model) to fill its share, so the all-max
            // row reaches the ceiling at the extremes and stays below it at 50/50.
            if (n == 6) assertEq(maxRate, RiskPolicy.MAX_RATE, "every driver at maximum reaches exactly 0.70%");
            if (n >= 1 && n <= 4) {
                assertGt(rateAtHalf, RiskPolicy.MIN_RATE, "each driver alone lifts the rate");
                assertLt(rateAtHalf, RiskPolicy.MAX_RATE, "no single driver reaches the ceiling");
            }
        }
    }

    /// @notice The spec's headline numbers, stated once so the docs can quote them.
    function test_headlineNumbers() public pure {
        // A $100 position (100 contracts) at 50/50 and the 0.70% ceiling.
        assertEq(F.contractFee(100e6, RiskPolicy.MAX_RATE, 5000), 175_000); // $0.175
        // The same position at the 0.10% floor.
        assertEq(F.contractFee(100e6, RiskPolicy.MIN_RATE, 5000), 25_000); // $0.025
        // Spending $100 of USDC at p = 0.50 buys 200 contracts: fee on the input.
        assertEq(F.feeOnInput(100e6, F.effectiveFeePips(RiskPolicy.MAX_RATE, 5000)), 350_000); // $0.35
        // At p = 0.95 the same $100 pays 0.035%.
        assertEq(F.feeOnInput(100e6, F.effectiveFeePips(RiskPolicy.MAX_RATE, 9500)), 35_000);
        // At p = 0.05 it pays 0.665% of the input — but buys 2000 contracts.
        assertEq(F.feeOnInput(100e6, F.effectiveFeePips(RiskPolicy.MAX_RATE, 500)), 665_000);
        assertEq(F.contractFee(2000e6, RiskPolicy.MAX_RATE, 500), 665_000, "same fee either way");
    }

    // ─── Trade-size extremes (H-015, H-016) ──────────────────────────────

    function test_extremelySmallAndLargeTradesArePriceable() public pure {
        uint24 fee = F.effectiveFeePips(RiskPolicy.MAX_RATE, 5000);
        assertEq(F.feeOnInput(1, fee), 1, "one raw unit pays one raw unit");
        assertEq(F.feeOnInput(2, fee), 1, "rounds up, never to zero for a non-zero input");
        assertEq(F.feeOnInput(1e6, fee), 3500);
        assertEq(F.feeOnInput(RiskPolicy.ABS_MAX_TRADE, fee), 35e6, "the cap-sized trade pays $35");
        assertGt(F.feeOnInput(type(uint128).max, fee), 0);
        assertLt(F.feeOnInput(type(uint256).max, fee), type(uint256).max, "no overflow at the type maximum");
        assertEq(F.contractFee(0, RiskPolicy.MAX_RATE, 5000), 0);
        assertEq(F.contractFee(1, RiskPolicy.MAX_RATE, 5000), 0, "a single raw contract's fee floors to zero");
    }
}
