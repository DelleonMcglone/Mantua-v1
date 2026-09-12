// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: tests for RiskPolicy — the immutable bounds every fee-rate and
// trade-cap clamp resolves against (spec §27; fee bounds per D-105, H-002).

import {Test} from "forge-std/Test.sol";
import {RiskPolicy} from "../../../src/hooks/dynamic-market/RiskPolicy.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

contract RiskPolicyTest is Test {
    // ─── Values (D-105) ──────────────────────────────────────────────────

    function test_feeBoundsMatchTheFeeModel() public pure {
        assertEq(RiskPolicy.REGULAR_SEASON_FEE, 0, "regular season is fee-free");
        assertEq(RiskPolicy.MIN_RATE, 1000, "MIN_RATE must be 0.10%");
        assertEq(RiskPolicy.MAX_RATE, 7000, "MAX_RATE must be 0.70%");
    }

    function test_tradeCapBoundsMatchSpec() public pure {
        assertEq(RiskPolicy.ABS_MAX_TRADE, 10_000e6, "ABS_MAX_TRADE must be $10,000");
        assertEq(RiskPolicy.MIN_TRADE_CAP, 100e6, "MIN_TRADE_CAP must be $100");
    }

    function test_timingsMatchSpec() public pure {
        assertEq(RiskPolicy.STALE_AFTER, 900, "STALE_AFTER must be 15 minutes");
        // D-103 in-play trading: the backstop must equal the market
        // contract's window (cross-contract equality asserted in Market.t.sol).
        assertEq(RiskPolicy.MAX_EVENT_DURATION, 12 hours, "backstop must be 12 hours");
    }

    // ─── Internal consistency ────────────────────────────────────────────

    function test_minRateIsBelowMaxRate() public pure {
        assertLt(RiskPolicy.MIN_RATE, RiskPolicy.MAX_RATE);
        assertLt(RiskPolicy.REGULAR_SEASON_FEE, RiskPolicy.MIN_RATE);
    }

    function test_minTradeCapIsBelowAbsMax() public pure {
        assertLt(RiskPolicy.MIN_TRADE_CAP, RiskPolicy.ABS_MAX_TRADE);
    }

    function test_maxRateIsAValidV4Fee() public pure {
        // A fee above MAX_LP_FEE would be rejected by the PoolManager, making
        // every stale-state swap revert instead of paying the ceiling (§22).
        assertLe(RiskPolicy.MAX_RATE, LPFeeLibrary.MAX_LP_FEE);
    }

    function test_headroomIsSharedByFourDrivers() public pure {
        // 0.60% of headroom split four ways still leaves each driver a share
        // wider than a pip, so the rate carries information.
        assertEq(RiskPolicy.MAX_RATE - RiskPolicy.MIN_RATE, 6000);
    }

    // ─── clampRate (H-002) ───────────────────────────────────────────────

    function test_clampRatePassesThroughInBandValues() public pure {
        assertEq(RiskPolicy.clampRate(1000), 1000);
        assertEq(RiskPolicy.clampRate(4000), 4000);
        assertEq(RiskPolicy.clampRate(7000), 7000);
    }

    function test_clampRateRaisesBelowTheFloor() public pure {
        assertEq(RiskPolicy.clampRate(0), RiskPolicy.MIN_RATE);
        assertEq(RiskPolicy.clampRate(999), RiskPolicy.MIN_RATE);
    }

    function test_clampRateCapsAboveTheCeiling() public pure {
        assertEq(RiskPolicy.clampRate(7001), RiskPolicy.MAX_RATE);
        assertEq(RiskPolicy.clampRate(type(uint24).max), RiskPolicy.MAX_RATE);
    }

    /// @dev H-002: no input can produce a rate above 0.70%.
    function testFuzz_clampRateAlwaysInBand(uint24 raw) public pure {
        uint24 rate = RiskPolicy.clampRate(raw);
        assertGe(rate, RiskPolicy.MIN_RATE);
        assertLe(rate, RiskPolicy.MAX_RATE);
    }

    // ─── clampTradeCap (§21) ─────────────────────────────────────────────

    function test_clampTradeCapPassesThroughInBandValues() public pure {
        assertEq(RiskPolicy.clampTradeCap(100e6), 100e6);
        assertEq(RiskPolicy.clampTradeCap(5000e6), 5000e6);
        assertEq(RiskPolicy.clampTradeCap(10_000e6), 10_000e6);
    }

    function test_clampTradeCapRaisesBelowMin() public pure {
        assertEq(RiskPolicy.clampTradeCap(0), RiskPolicy.MIN_TRADE_CAP);
        assertEq(RiskPolicy.clampTradeCap(1), RiskPolicy.MIN_TRADE_CAP);
    }

    function test_clampTradeCapCapsAboveAbsMax() public pure {
        assertEq(RiskPolicy.clampTradeCap(10_000e6 + 1), RiskPolicy.ABS_MAX_TRADE);
        assertEq(RiskPolicy.clampTradeCap(type(uint256).max), RiskPolicy.ABS_MAX_TRADE);
    }

    function testFuzz_clampTradeCapAlwaysInBand(uint256 raw) public pure {
        uint256 cap = RiskPolicy.clampTradeCap(raw);
        assertGe(cap, RiskPolicy.MIN_TRADE_CAP);
        assertLe(cap, RiskPolicy.ABS_MAX_TRADE);
    }

    // ─── isStale (§22) ───────────────────────────────────────────────────

    function test_isStaleFalseWithinWindow() public pure {
        assertFalse(RiskPolicy.isStale(1000, 1000), "same second is fresh");
        assertFalse(RiskPolicy.isStale(1000, 1000 + 899), "one second inside the window");
        assertFalse(RiskPolicy.isStale(1000, 1000 + 900), "exactly at the boundary is fresh");
    }

    function test_isStaleTrueBeyondWindow() public pure {
        assertTrue(RiskPolicy.isStale(1000, 1000 + 901));
    }

    function test_isStaleTreatsNeverUpdatedAsStale() public pure {
        // A pool registered but never written by the keeper must fail closed,
        // not read as fresh at timestamp 0.
        assertTrue(RiskPolicy.isStale(0, 1));
    }

    function test_isStaleHandlesClockBeforeUpdate() public pure {
        // Defensive: a lastUpdate in the future must not underflow.
        assertFalse(RiskPolicy.isStale(2000, 1000));
    }

    // ─── isPastBackstop (§6, D-103) ──────────────────────────────────────

    function test_backstopSilentBeforeKickoff() public pure {
        assertFalse(RiskPolicy.isPastBackstop(1000, 999));
    }

    function test_backstopSilentDuringTheGame() public pure {
        assertFalse(RiskPolicy.isPastBackstop(1000, 1000));
        assertFalse(RiskPolicy.isPastBackstop(1000, 1000 + 12 hours - 1));
    }

    function test_backstopFiresAtExactlyKickoffPlusMaxDuration() public pure {
        assertTrue(RiskPolicy.isPastBackstop(1000, 1000 + 12 hours));
        assertTrue(RiskPolicy.isPastBackstop(1000, 1000 + 12 hours + 1));
    }

    function test_backstopDoesNotOverflowNearMaxKickoff() public pure {
        uint64 k = type(uint64).max - 1;
        assertFalse(RiskPolicy.isPastBackstop(k, type(uint64).max));
    }

    function testFuzz_backstopIsMonotonicInTime(uint64 kickoff, uint64 t) public pure {
        vm.assume(t < type(uint64).max);
        if (RiskPolicy.isPastBackstop(kickoff, t)) {
            assertTrue(RiskPolicy.isPastBackstop(kickoff, t + 1), "backstop must never un-fire");
        }
    }
}
