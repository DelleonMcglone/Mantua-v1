// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: tests for MarketMath — price to probability, USDC notional, EWMA
// volatility, flow decay, imbalance. Spec §10, §13, §14, §20.
// Covers edge cases 1-4 (both token orderings), 5 (zero liquidity), 6-10
// (zero/max volume, volatility, imbalance) from spec §33.

import {Test} from "forge-std/Test.sol";
import {MarketMath} from "../../../src/hooks/dynamic-market/MarketMath.sol";

contract MarketMathTest is Test {
    uint256 constant Q96 = 2 ** 96;

    /// @dev sqrtPriceX96 for a YES priced at `pctNum/pctDen` USDC.
    function _sqrtPrice(uint256 pctNum, uint256 pctDen, bool yesIsToken0) internal pure returns (uint160) {
        // v4 price is token1 per token0. YES as token0 → price = p.
        // YES as token1 → price = 1/p.
        (uint256 num, uint256 den) = yesIsToken0 ? (pctNum, pctDen) : (pctDen, pctNum);
        return uint160(_sqrt((num << 192) / den));
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ─── Probability, both orderings (§10; edge cases 1-4) ───────────────

    function test_probabilityWhenYesIsToken0() public pure {
        assertApproxEqAbs(MarketMath.probabilityBps(_sqrtPrice(62, 100, true), true), 6200, 2);
        assertApproxEqAbs(MarketMath.probabilityBps(_sqrtPrice(1, 2, true), true), 5000, 2);
        assertApproxEqAbs(MarketMath.probabilityBps(_sqrtPrice(5, 100, true), true), 500, 2);
    }

    function test_probabilityWhenYesIsToken1() public pure {
        assertApproxEqAbs(MarketMath.probabilityBps(_sqrtPrice(62, 100, false), false), 6200, 2);
        assertApproxEqAbs(MarketMath.probabilityBps(_sqrtPrice(1, 2, false), false), 5000, 2);
        assertApproxEqAbs(MarketMath.probabilityBps(_sqrtPrice(5, 100, false), false), 500, 2);
    }

    /// @dev The silent failure this guards. Reading a pool with the ordering
    ///      flag inverted does not mirror the probability — it inverts the
    ///      price, so a 25% market reads as a near-certainty and clamps to
    ///      100%. No revert anywhere, which is why the registry records the
    ///      ordering once at registration instead of letting callers pass it.
    function test_wrongOrderingSaturatesRatherThanMirroring() public pure {
        uint160 sp = _sqrtPrice(25, 100, true);
        assertApproxEqAbs(MarketMath.probabilityBps(sp, true), 2500, 2);
        assertEq(MarketMath.probabilityBps(sp, false), 10_000, "1/0.25 = 4 -> clamped to certainty");
    }

    function test_probabilityIsClampedIntoRange() public pure {
        assertLe(MarketMath.probabilityBps(type(uint160).max, true), 10_000);
        assertLe(MarketMath.probabilityBps(1, true), 10_000);
        assertLe(MarketMath.probabilityBps(type(uint160).max, false), 10_000);
    }

    function test_probabilityHandlesZeroPriceWithoutReverting() public pure {
        // An uninitialised pool reads sqrtPriceX96 == 0. Must not divide by zero.
        assertEq(MarketMath.probabilityBps(0, true), 0);
        assertEq(MarketMath.probabilityBps(0, false), 0);
    }

    function testFuzz_probabilityAlwaysInRange(uint160 sqrtPriceX96, bool yesIsToken0) public pure {
        assertLe(MarketMath.probabilityBps(sqrtPriceX96, yesIsToken0), 10_000);
    }

    // ─── USDC notional (§20) ─────────────────────────────────────────────

    function test_notionalIsExactWhenTheTokenIsUsdc() public pure {
        // exactInput of token0, YES is token1 → the specified token is USDC.
        uint256 n = MarketMath.usdcNotional(-500e6, true, false, 6200, 6);
        assertEq(n, 500e6, "USDC leg needs no conversion");
    }

    function test_notionalConvertsYesAtTheMarketProbability() public pure {
        // exactInput of token0, YES is token0 → specified token is YES.
        uint256 n = MarketMath.usdcNotional(-1000e6, true, true, 6200, 6);
        assertEq(n, 620e6, "1000 YES at 62c is $620 of risk");
    }

    function test_notionalHandlesExactOutputOnBothSides() public pure {
        // exactOutput (positive) of token1. YES is token0 → output is USDC.
        assertEq(MarketMath.usdcNotional(300e6, true, true, 5000, 6), 300e6);
        // exactOutput of token1 where YES is token1 → output is YES.
        assertEq(MarketMath.usdcNotional(300e6, true, false, 5000, 6), 150e6);
    }

    function test_notionalTreatsZeroProbabilityAsZeroRisk() public pure {
        assertEq(MarketMath.usdcNotional(-1000e6, true, true, 0, 6), 0);
    }

    function test_notionalScalesNonSixDecimalOutcomeTokens() public pure {
        // Spec §9: if the outcome token were 18dp, a raw amount must be scaled
        // down to 6dp before comparing against a USDC cap.
        uint256 n = MarketMath.usdcNotional(-1000e18, true, true, 10_000, 18);
        assertEq(n, 1000e6, "18dp YES at parity is $1000");
    }

    function testFuzz_notionalNeverExceedsScaledAmount(int128 amount, bool zeroForOne, bool yesIsToken0) public pure {
        vm.assume(amount != 0);
        int256 wide = int256(amount);
        uint256 raw = wide < 0 ? uint256(-wide) : uint256(wide);
        uint256 n = MarketMath.usdcNotional(amount, zeroForOne, yesIsToken0, 10_000, 6);
        assertLe(n, raw, "at p=1 notional equals size; it can never exceed it");
    }

    // ─── EWMA volatility (§13; edge cases 7, 8) ──────────────────────────

    function test_volatilityStartsFromTheFirstObservation() public pure {
        assertEq(MarketMath.ewma(0, 400, 2000), 80, "alpha applied to a zero prior");
    }

    function test_volatilityDecaysTowardZeroWithCalmObservations() public pure {
        uint256 v = 1000;
        for (uint256 i = 0; i < 20; i++) {
            v = MarketMath.ewma(v, 0, 2000);
        }
        assertLt(v, 20, "twenty calm ticks must nearly erase the prior");
    }

    function test_volatilityIsBoundedAtMax() public pure {
        uint256 v = MarketMath.ewma(10_000, 10_000, 10_000);
        assertLe(v, 10_000, "cannot exceed the bps ceiling");
    }

    function test_volatilityWithZeroAlphaHoldsThePrior() public pure {
        assertEq(MarketMath.ewma(777, 10_000, 0), 777);
    }

    function testFuzz_ewmaStaysWithinBps(uint16 prev, uint16 obs, uint16 alpha) public pure {
        uint256 p = bound(uint256(prev), 0, 10_000);
        uint256 o = bound(uint256(obs), 0, 10_000);
        uint256 a = bound(uint256(alpha), 0, 10_000);
        assertLe(MarketMath.ewma(p, o, a), 10_000);
    }

    // ─── Flow decay (§14; edge case 11 same-block) ───────────────────────

    function test_flowIsUnchangedInTheSameBlock() public pure {
        // Edge case 11: two swaps in one block must not decay between them.
        assertEq(MarketMath.decayFlow(1000, 0), 1000);
    }

    function test_flowHalvesAtTheHalfLife() public pure {
        assertEq(MarketMath.decayFlow(1000, MarketMath.FLOW_HALF_LIFE), 500);
    }

    function test_flowDecaysMonotonicallyAndReachesZero() public pure {
        uint256 a = MarketMath.decayFlow(1000, 60);
        uint256 b = MarketMath.decayFlow(1000, 600);
        uint256 c = MarketMath.decayFlow(1000, 100_000);
        assertGt(a, b);
        assertGt(b, c);
        assertEq(c, 0, "old flow must stop affecting fees");
    }

    function test_zeroFlowStaysZero() public pure {
        assertEq(MarketMath.decayFlow(0, 500), 0);
    }

    function testFuzz_decayNeverIncreasesFlow(uint128 flow, uint64 elapsed) public pure {
        assertLe(MarketMath.decayFlow(flow, elapsed), flow);
    }

    // ─── Imbalance (§14; edge cases 5, 9, 10) ────────────────────────────

    function test_imbalanceIsZeroWhenFlowsMatch() public pure {
        assertEq(MarketMath.imbalanceBps(500, 500, 1_000_000), 0);
    }

    function test_imbalanceGrowsWithTheNetSide() public pure {
        uint256 small = MarketMath.imbalanceBps(600, 500, 1_000_000);
        uint256 large = MarketMath.imbalanceBps(900, 100, 1_000_000);
        assertGt(large, small);
    }

    function test_imbalanceIsSymmetric() public pure {
        assertEq(MarketMath.imbalanceBps(900, 100, 1_000_000), MarketMath.imbalanceBps(100, 900, 1_000_000));
    }

    /// @dev Edge case 5: zero liquidity must read as maximum imbalance rather
    ///      than dividing by zero — the fee then moves to its risk maximum.
    function test_zeroLiquidityIsMaximumImbalanceNotARevert() public pure {
        assertEq(MarketMath.imbalanceBps(1, 0, 0), 10_000);
    }

    function test_zeroFlowAndZeroLiquidityIsZeroImbalance() public pure {
        // Edge case 6: no volume at all. An idle pool is not a risky pool.
        assertEq(MarketMath.imbalanceBps(0, 0, 0), 0);
    }

    function test_imbalanceIsCappedAtBps() public pure {
        assertEq(MarketMath.imbalanceBps(type(uint128).max, 0, 1), 10_000);
    }

    function testFuzz_imbalanceAlwaysInBps(uint128 buy, uint128 sell, uint128 liq) public pure {
        assertLe(MarketMath.imbalanceBps(buy, sell, liq), 10_000);
    }
}
