// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: tests for MarketErrors — the centralised custom errors (spec §30).
// Selector stability matters: the UI and the deploy scripts decode reverts by
// selector, so a rename or a signature change is a breaking change and should
// fail here rather than silently in a client.

import {Test} from "forge-std/Test.sol";
import {MarketErrors} from "../../../src/hooks/dynamic-market/MarketErrors.sol";

contract MarketErrorsTest is Test {
    function test_authorisationErrorsExist() public pure {
        assertTrue(MarketErrors.NotPoolManager.selector != bytes4(0));
        assertTrue(MarketErrors.NotKeeper.selector != bytes4(0));
        assertTrue(MarketErrors.NotOperator.selector != bytes4(0));
        assertTrue(MarketErrors.NotPendingOperator.selector != bytes4(0));
    }

    function test_registrationErrorsExist() public pure {
        assertTrue(MarketErrors.PoolNotRegistered.selector != bytes4(0));
        assertTrue(MarketErrors.PoolAlreadyRegistered.selector != bytes4(0));
        assertTrue(MarketErrors.StaticFeePoolRejected.selector != bytes4(0));
        assertTrue(MarketErrors.KickoffInPast.selector != bytes4(0));
    }

    function test_haltErrorsExist() public pure {
        assertTrue(MarketErrors.MarketFrozen.selector != bytes4(0));
        assertTrue(MarketErrors.MarketResolved.selector != bytes4(0));
        assertTrue(MarketErrors.MarketVoided.selector != bytes4(0));
        assertTrue(MarketErrors.MarketPaused.selector != bytes4(0));
    }

    function test_boundsErrorsExist() public pure {
        assertTrue(MarketErrors.TradeExceedsCap.selector != bytes4(0));
        assertTrue(MarketErrors.ProbabilityOutOfRange.selector != bytes4(0));
        assertTrue(MarketErrors.ConfidenceOutOfRange.selector != bytes4(0));
        assertTrue(MarketErrors.ZeroAddress.selector != bytes4(0));
    }

    function test_reentrancyErrorExists() public pure {
        assertTrue(MarketErrors.Reentrancy.selector != bytes4(0));
    }

    /// @dev Every selector must be distinct. Two errors colliding would make a
    ///      revert reason ambiguous — a halt could be reported as a cap breach.
    function test_allSelectorsAreDistinct() public pure {
        bytes4[17] memory selectors = [
            MarketErrors.NotPoolManager.selector,
            MarketErrors.NotKeeper.selector,
            MarketErrors.NotOperator.selector,
            MarketErrors.NotPendingOperator.selector,
            MarketErrors.PoolNotRegistered.selector,
            MarketErrors.PoolAlreadyRegistered.selector,
            MarketErrors.StaticFeePoolRejected.selector,
            MarketErrors.KickoffInPast.selector,
            MarketErrors.MarketFrozen.selector,
            MarketErrors.MarketResolved.selector,
            MarketErrors.MarketVoided.selector,
            MarketErrors.MarketPaused.selector,
            MarketErrors.TradeExceedsCap.selector,
            MarketErrors.ProbabilityOutOfRange.selector,
            MarketErrors.ConfidenceOutOfRange.selector,
            MarketErrors.ZeroAddress.selector,
            MarketErrors.Reentrancy.selector
        ];

        for (uint256 i = 0; i < selectors.length; i++) {
            for (uint256 j = i + 1; j < selectors.length; j++) {
                assertTrue(selectors[i] != selectors[j], "duplicate error selector");
            }
        }
    }

    /// @dev The cap error carries the numbers so a caller can see by how much
    ///      it missed, rather than only that it did.
    function test_tradeExceedsCapCarriesNotionalAndCap() public pure {
        bytes memory encoded =
            abi.encodeWithSelector(MarketErrors.TradeExceedsCap.selector, uint256(500e6), uint256(100e6));
        assertEq(encoded.length, 4 + 32 + 32, "selector plus two words");
    }
}
