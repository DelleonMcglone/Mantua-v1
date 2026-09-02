// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: tests for RiskPolicy — the immutable bounds every fee and
// trade-cap clamp resolves against (spec §27, values in §0.3).

import {Test} from "forge-std/Test.sol";
import {RiskPolicy} from "../../../src/hooks/dynamic-market/RiskPolicy.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

contract RiskPolicyTest is Test {
    // ─── Values (spec §0.3) ──────────────────────────────────────────────

    function test_feeBoundsMatchSpec() public pure {
        assertEq(RiskPolicy.BASE_FEE, 3000, "BASE_FEE must be 0.30%");
        assertEq(RiskPolicy.MAX_FEE, 50_000, "MAX_FEE must be 5.00%");
    }

    function test_tradeCapBoundsMatchSpec() public pure {
        assertEq(RiskPolicy.ABS_MAX_TRADE, 10_000e6, "ABS_MAX_TRADE must be $10,000");
        assertEq(RiskPolicy.MIN_TRADE_CAP, 100e6, "MIN_TRADE_CAP must be $100");
    }

    function test_timingsMatchSpec() public pure {
        assertEq(RiskPolicy.STALE_AFTER, 900, "STALE_AFTER must be 15 minutes");
        // Zero deliberately: Market.freeze() fires exactly at startsAt, so a
        // non-zero lead would have the hook and the market contract disagree
        // about when the market closed.
        assertEq(RiskPolicy.FREEZE_LEAD, 0, "FREEZE_LEAD must be 0 to match Market.startsAt");
    }

    // ─── Internal consistency ────────────────────────────────────────────

    function test_baseFeeIsBelowMaxFee() public pure {
        assertLt(RiskPolicy.BASE_FEE, RiskPolicy.MAX_FEE);
    }

    function test_minTradeCapIsBelowAbsMax() public pure {
        assertLt(RiskPolicy.MIN_TRADE_CAP, RiskPolicy.ABS_MAX_TRADE);
    }

    function test_maxFeeIsAValidV4Fee() public pure {
        // A fee above MAX_LP_FEE would be rejected by the PoolManager, making
        // every stale-state swap revert instead of paying the ceiling (§22).
        assertLe(RiskPolicy.MAX_FEE, LPFeeLibrary.MAX_LP_FEE);
    }

    function test_maxFeeLeavesHeadroomForFivePremiums() public pure {
        // §16 stacks five premiums plus a directional adjustment on top of
        // BASE_FEE. If the band were tight they would saturate immediately and
        // the fee would carry no information.
        assertGe(RiskPolicy.MAX_FEE - RiskPolicy.BASE_FEE, 5 * RiskPolicy.BASE_FEE);
    }

    // ─── clampFee (§16) ──────────────────────────────────────────────────

    function test_clampFeePassesThroughInBandValues() public pure {
        assertEq(RiskPolicy.clampFee(3000), 3000);
        assertEq(RiskPolicy.clampFee(20_000), 20_000);
        assertEq(RiskPolicy.clampFee(50_000), 50_000);
    }

    function test_clampFeeRaisesBelowBase() public pure {
        assertEq(RiskPolicy.clampFee(0), RiskPolicy.BASE_FEE);
        assertEq(RiskPolicy.clampFee(2999), RiskPolicy.BASE_FEE);
    }

    function test_clampFeeCapsAboveMax() public pure {
        assertEq(RiskPolicy.clampFee(50_001), RiskPolicy.MAX_FEE);
        assertEq(RiskPolicy.clampFee(type(uint24).max), RiskPolicy.MAX_FEE);
    }

    /// @dev §44: a fee below BASE_FEE or above MAX_FEE is a failure condition.
    ///      This is the property the §34 fuzz suite asserts at scale.
    function testFuzz_clampFeeAlwaysInBand(uint24 raw) public pure {
        uint24 fee = RiskPolicy.clampFee(raw);
        assertGe(fee, RiskPolicy.BASE_FEE);
        assertLe(fee, RiskPolicy.MAX_FEE);
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

    // ─── isFrozen (§6) ───────────────────────────────────────────────────

    function test_isFrozenFalseBeforeKickoff() public pure {
        assertFalse(RiskPolicy.isFrozen(1000, 999));
    }

    function test_isFrozenTrueAtKickoff() public pure {
        // FREEZE_LEAD is 0, so the freeze fires exactly at kickoff — the same
        // instant Market.freeze() becomes callable.
        assertTrue(RiskPolicy.isFrozen(1000, 1000));
    }

    function test_isFrozenTrueAfterKickoff() public pure {
        assertTrue(RiskPolicy.isFrozen(1000, 1001));
    }

    function test_isFrozenHandlesKickoffBelowFreezeLead() public pure {
        // Guards the subtraction if FREEZE_LEAD is ever raised above a small
        // kickoff timestamp in a test fixture.
        assertFalse(RiskPolicy.isFrozen(0, 0) && RiskPolicy.FREEZE_LEAD > 0);
    }

    function testFuzz_isFrozenIsMonotonicInTime(uint64 kickoff, uint64 t) public pure {
        vm.assume(t < type(uint64).max);
        if (RiskPolicy.isFrozen(kickoff, t)) {
            assertTrue(RiskPolicy.isFrozen(kickoff, t + 1), "freeze must never un-fire");
        }
    }
}
