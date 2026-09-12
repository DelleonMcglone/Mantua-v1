// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: tests for MarketFeeFormula — Fee = C × rate × p × (1 − p) and its
// v4 pip realisation. D-105 / task 049: H-001, H-005, H-006, H-015, H-016.
// The vectors in fee-vectors.json are shared with the TypeScript mirror.

import {Test} from "forge-std/Test.sol";
import {MarketFeeFormula as F} from "../../../src/hooks/dynamic-market/MarketFeeFormula.sol";
import {RiskPolicy} from "../../../src/hooks/dynamic-market/RiskPolicy.sol";

contract MarketFeeFormulaTest is Test {
    uint256 constant BPS = 10_000;
    string constant VECTORS = "test/hooks/dynamic-market/fee-vectors.json";

    // ─── Shared vectors (H-012: the UI mirror asserts the same file) ─────

    function test_vectorsMatchTheSharedFile() public view {
        string memory json = vm.readFile(VECTORS);
        uint256[] memory rate = vm.parseJsonUintArray(json, ".ratePips");
        uint256[] memory p = vm.parseJsonUintArray(json, ".probabilityBps");
        uint256[] memory pips = vm.parseJsonUintArray(json, ".feePips");
        uint256[] memory c = vm.parseJsonUintArray(json, ".contracts");
        uint256[] memory fee = vm.parseJsonUintArray(json, ".contractFee");
        assertGt(rate.length, 10, "vector file must carry the matrix");
        for (uint256 i = 0; i < rate.length; i++) {
            assertEq(F.effectiveFeePips(uint24(rate[i]), p[i]), pips[i], "feePips vector");
            assertEq(F.contractFee(c[i], uint24(rate[i]), p[i]), fee[i], "contractFee vector");
        }
        uint256[] memory amountIn = vm.parseJsonUintArray(json, ".inputFee.amountIn");
        uint256[] memory inPips = vm.parseJsonUintArray(json, ".inputFee.feePips");
        uint256[] memory inFee = vm.parseJsonUintArray(json, ".inputFee.fee");
        for (uint256 i = 0; i < amountIn.length; i++) {
            assertEq(F.feeOnInput(amountIn[i], uint24(inPips[i])), inFee[i], "feeOnInput vector");
        }
    }

    // ─── The spec's worked shape (H-015 probability sweep) ───────────────

    function test_perContractFeePeaksAtEvenOdds() public pure {
        uint16[7] memory sweep = [0, 1000, 2500, 5000, 7500, 9000, 10_000];
        uint256 peak = F.contractFee(100e6, RiskPolicy.MAX_RATE, 5000);
        assertEq(peak, 175_000, "100 contracts at 0.70% and 50/50 cost $0.175");
        for (uint256 i = 0; i < sweep.length; i++) {
            assertLe(F.contractFee(100e6, RiskPolicy.MAX_RATE, sweep[i]), peak);
        }
        assertEq(F.contractFee(100e6, RiskPolicy.MAX_RATE, 0), 0, "a free contract carries no fee");
        assertEq(F.contractFee(100e6, RiskPolicy.MAX_RATE, 10_000), 0, "a certain contract carries no fee");
    }

    function test_perContractFeeIsSymmetricAroundEvenOdds() public pure {
        for (uint256 p = 0; p <= 5000; p += 250) {
            assertEq(F.contractFee(1e9, 4321, p), F.contractFee(1e9, 4321, BPS - p));
        }
    }

    function test_perContractFeeDeclinesMonotonicallyTowardTheExtremes() public pure {
        uint256 prev = 0;
        for (uint256 p = 0; p <= 5000; p += 100) {
            uint256 fee = F.contractFee(1e12, RiskPolicy.MAX_RATE, p);
            assertGe(fee, prev, "rising toward 0.50");
            prev = fee;
        }
        for (uint256 p = 5000; p <= BPS; p += 100) {
            uint256 fee = F.contractFee(1e12, RiskPolicy.MAX_RATE, p);
            assertLe(fee, prev, "falling toward 1.00");
            prev = fee;
        }
    }

    function test_pipFeeIsRateTimesOneMinusP() public pure {
        assertEq(F.effectiveFeePips(7000, 5000), 3500);
        assertEq(F.effectiveFeePips(7000, 0), 7000, "at p = 0 the input rate is the full rate");
        assertEq(F.effectiveFeePips(7000, 10_000), 0, "at p = 1 nothing is charged");
        assertEq(F.effectiveFeePips(0, 5000), 0, "regular season");
    }

    /// @dev The derivation in the library header: pip fee on the input equals
    ///      the per-contract fee divided by the contract's value.
    function testFuzz_pipFeeRealisesThePerContractFormula(uint24 rate, uint16 p, uint96 contracts) public pure {
        rate = uint24(bound(uint256(rate), 0, RiskPolicy.MAX_RATE));
        p = uint16(bound(uint256(p), 1, BPS - 1));
        // Gross YES input of `contracts`: v4 takes feePips of it, worth p each.
        uint256 viaPips = (uint256(contracts) * F.effectiveFeePips(rate, p) * p) / (F.PIPS * BPS);
        uint256 viaFormula = F.contractFee(contracts, rate, p);
        // Only the pip floor separates them: at most p/BPS of one pip of C.
        assertApproxEqAbs(viaPips, viaFormula, uint256(contracts) / F.PIPS + 1);
        assertLe(viaPips, viaFormula, "flooring the pip rate never over-charges");
    }

    // ─── Ceiling (H-002, H-006) ──────────────────────────────────────────

    function testFuzz_pipFeeNeverExceedsTheRate(uint24 rate, uint256 p) public pure {
        assertLe(F.effectiveFeePips(rate, p), rate);
    }

    function testFuzz_feeIsZeroInTheRegularSeasonForAnyPrice(uint256 p, uint256 contracts) public pure {
        assertEq(F.effectiveFeePips(RiskPolicy.REGULAR_SEASON_FEE, p), 0);
        assertEq(F.contractFee(contracts, RiskPolicy.REGULAR_SEASON_FEE, p), 0);
    }

    // ─── Rounding, precision, overflow (H-016) ───────────────────────────

    function test_pipFeeFloorsToAtMostOnePipOfError() public pure {
        // 7000 × 9999 / 10000 = 6999.3 → 6999; 4000 × 6667 / 10000 = 2666.8 → 2666.
        assertEq(F.effectiveFeePips(7000, 1), 6999);
        assertEq(F.effectiveFeePips(4000, 3333), 2666);
        // Sub-pip results floor to zero rather than rounding up past the formula.
        assertEq(F.effectiveFeePips(7000, 9999), 0);
    }

    function test_inputFeeRoundsUpLikeSwapMath() public pure {
        assertEq(F.feeOnInput(1, 3500), 1, "one raw unit still pays one raw unit");
        assertEq(F.feeOnInput(100e6, 3500), 350_000);
        assertEq(F.feeOnInput(0, 7000), 0);
        assertEq(F.feeOnInput(100e6, 0), 0);
    }

    function test_extremeAmountsDoNotOverflow() public pure {
        uint256 max = type(uint256).max;
        assertLt(F.contractFee(max, RiskPolicy.MAX_RATE, 5000), max);
        assertEq(
            F.contractFee(type(uint128).max, RiskPolicy.MAX_RATE, 5000), 595_494_142_111_642_311_060_905_563_005_594_370
        );
        assertEq(
            F.feeOnInput(type(uint128).max, RiskPolicy.MAX_RATE), 2_381_976_568_446_569_244_243_622_252_022_377_481
        );
        // Out-of-range probability inputs are clamped, never reverted.
        assertEq(F.contractFee(1e6, RiskPolicy.MAX_RATE, max), 0);
        assertEq(F.effectiveFeePips(RiskPolicy.MAX_RATE, max), 0);
    }

    function testFuzz_formulaIsTotal(uint256 contracts, uint24 rate, uint256 p) public pure {
        F.contractFee(contracts, rate, p);
        F.effectiveFeePips(rate, p);
        if (rate <= F.PIPS) F.feeOnInput(contracts, rate);
    }
}
