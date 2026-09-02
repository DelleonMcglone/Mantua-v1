// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: tests for MarketStateRegistry — registration, keeper/operator
// separation, two-step transfer, pause. Spec §8, §25, §26, §28.4.

import {Test} from "forge-std/Test.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {MarketStateRegistry} from "../../../src/hooks/dynamic-market/MarketStateRegistry.sol";
import {IMarketStateRegistry as I} from "../../../src/hooks/dynamic-market/IMarketStateRegistry.sol";
import {MarketErrors} from "../../../src/hooks/dynamic-market/MarketErrors.sol";

contract MarketStateRegistryTest is Test {
    MarketStateRegistry registry;

    address operator = makeAddr("operator");
    address keeper = makeAddr("keeper");
    address stranger = makeAddr("stranger");

    PoolId constant POOL = PoolId.wrap(bytes32(uint256(1)));
    PoolId constant OTHER = PoolId.wrap(bytes32(uint256(2)));

    uint64 kickoff;

    function setUp() public {
        vm.warp(1_000_000);
        kickoff = uint64(block.timestamp + 1 days);
        registry = new MarketStateRegistry(operator, keeper);
    }

    function _register(PoolId id) internal {
        vm.prank(operator);
        registry.registerPool(id, kickoff, kickoff + 4 hours, true, 6);
    }

    // ─── Construction ────────────────────────────────────────────────────

    function test_rolesAreSetAndDistinct() public view {
        assertEq(registry.operator(), operator);
        assertEq(registry.keeper(), keeper);
        assertTrue(registry.operator() != registry.keeper(), "spec 25 requires separate roles");
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(MarketErrors.ZeroAddress.selector);
        new MarketStateRegistry(address(0), keeper);
        vm.expectRevert(MarketErrors.ZeroAddress.selector);
        new MarketStateRegistry(operator, address(0));
    }

    // ─── Registration (§8) ───────────────────────────────────────────────

    function test_registerStoresState() public {
        _register(POOL);
        I.MarketState memory s = registry.marketState(POOL);
        assertTrue(s.registered);
        assertEq(s.kickoffTimestamp, kickoff);
        assertTrue(s.yesIsToken0);
        assertEq(s.outcomeDecimals, 6);
        assertEq(uint8(s.eventState), uint8(I.EventState.PRE_GAME));
        assertEq(s.lastUpdate, 0, "never written by the keeper yet");
    }

    function test_unregisteredPoolReadsFalse() public view {
        assertFalse(registry.isRegistered(POOL));
    }

    function test_onlyOperatorMayRegister() public {
        vm.prank(keeper);
        vm.expectRevert(MarketErrors.NotOperator.selector);
        registry.registerPool(POOL, kickoff, kickoff + 4 hours, true, 6);
    }

    function test_cannotRegisterTwice() public {
        _register(POOL);
        vm.prank(operator);
        vm.expectRevert(MarketErrors.PoolAlreadyRegistered.selector);
        registry.registerPool(POOL, kickoff, kickoff + 4 hours, true, 6);
    }

    function test_cannotRegisterKickoffInPast() public {
        vm.prank(operator);
        vm.expectRevert(MarketErrors.KickoffInPast.selector);
        registry.registerPool(POOL, uint64(block.timestamp), kickoff, true, 6);
    }

    function test_marketStateRevertsForUnregisteredPool() public {
        vm.expectRevert(MarketErrors.PoolNotRegistered.selector);
        registry.marketState(POOL);
    }

    /// @dev Spec §25: the keeper must not be able to move a kickoff timestamp
    ///      after registration — that would defeat the §6 freeze.
    function test_registryExposesNoKickoffSetter() public {
        _register(POOL);
        I.MarketState memory before = registry.marketState(POOL);
        vm.prank(keeper);
        registry.updateMarket(POOL, 4300, 9100, I.EventState.LIVE);
        assertEq(registry.marketState(POOL).kickoffTimestamp, before.kickoffTimestamp);
    }

    // ─── Keeper writes (§4.1, §28.4) ─────────────────────────────────────

    function test_keeperWritesThreeFieldsAndStampsTime() public {
        _register(POOL);
        vm.prank(keeper);
        registry.updateMarket(POOL, 4300, 9100, I.EventState.LIVE);

        I.MarketState memory s = registry.marketState(POOL);
        assertEq(s.modelProbability, 4300);
        assertEq(s.confidence, 9100);
        assertEq(uint8(s.eventState), uint8(I.EventState.LIVE));
        assertEq(s.lastUpdate, uint64(block.timestamp));
    }

    function test_onlyKeeperMayUpdate() public {
        _register(POOL);
        vm.prank(operator);
        vm.expectRevert(MarketErrors.NotKeeper.selector);
        registry.updateMarket(POOL, 4300, 9100, I.EventState.LIVE);
    }

    function test_updateRequiresRegistration() public {
        vm.prank(keeper);
        vm.expectRevert(MarketErrors.PoolNotRegistered.selector);
        registry.updateMarket(POOL, 4300, 9100, I.EventState.LIVE);
    }

    function test_rejectsProbabilityAboveTenThousandBps() public {
        _register(POOL);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(MarketErrors.ProbabilityOutOfRange.selector, 10_001));
        registry.updateMarket(POOL, 10_001, 9100, I.EventState.LIVE);
    }

    function test_rejectsConfidenceAboveTenThousandBps() public {
        _register(POOL);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(MarketErrors.ConfidenceOutOfRange.selector, 10_001));
        registry.updateMarket(POOL, 4300, 10_001, I.EventState.LIVE);
    }

    function test_acceptsBoundaryValues() public {
        _register(POOL);
        vm.prank(keeper);
        registry.updateMarket(POOL, 0, 0, I.EventState.PRE_GAME);
        vm.prank(keeper);
        registry.updateMarket(POOL, 10_000, 10_000, I.EventState.CRITICAL);
        assertEq(registry.marketState(POOL).modelProbability, 10_000);
    }

    function test_keeperCannotPause() public {
        _register(POOL);
        vm.prank(keeper);
        vm.expectRevert(MarketErrors.NotOperator.selector);
        registry.setPaused(POOL, true);
    }

    // ─── Pause (§24) ─────────────────────────────────────────────────────

    function test_operatorPausesAndUnpausesOnePool() public {
        _register(POOL);
        _register(OTHER);
        vm.prank(operator);
        registry.setPaused(POOL, true);
        assertTrue(registry.marketState(POOL).paused);
        assertFalse(registry.marketState(OTHER).paused, "pause must be per pool");

        vm.prank(operator);
        registry.setPaused(POOL, false);
        assertFalse(registry.marketState(POOL).paused);
    }

    function test_globalPauseIsSeparateAndOperatorOnly() public {
        assertFalse(registry.globalPaused());
        vm.prank(stranger);
        vm.expectRevert(MarketErrors.NotOperator.selector);
        registry.setGlobalPaused(true);

        vm.prank(operator);
        registry.setGlobalPaused(true);
        assertTrue(registry.globalPaused());
    }

    // ─── Two-step operator transfer (§26) ────────────────────────────────

    function test_transferRequiresProposeThenAccept() public {
        address next = makeAddr("next");
        vm.prank(operator);
        registry.proposeOperator(next);
        assertEq(registry.operator(), operator, "not yet transferred");
        assertEq(registry.pendingOperator(), next);

        vm.prank(next);
        registry.acceptOperator();
        assertEq(registry.operator(), next);
        assertEq(registry.pendingOperator(), address(0), "pending must clear");
    }

    function test_onlyOperatorMayPropose() public {
        vm.prank(stranger);
        vm.expectRevert(MarketErrors.NotOperator.selector);
        registry.proposeOperator(stranger);
    }

    function test_onlyPendingOperatorMayAccept() public {
        address next = makeAddr("next");
        vm.prank(operator);
        registry.proposeOperator(next);

        vm.prank(stranger);
        vm.expectRevert(MarketErrors.NotPendingOperator.selector);
        registry.acceptOperator();
    }

    /// @dev The point of two steps: a typo'd address cannot take the role,
    ///      because it has to act to claim it.
    function test_mistypedProposalCanBeOverwritten() public {
        vm.prank(operator);
        registry.proposeOperator(makeAddr("typo"));
        address right = makeAddr("right");
        vm.prank(operator);
        registry.proposeOperator(right);
        assertEq(registry.pendingOperator(), right);

        vm.prank(right);
        registry.acceptOperator();
        assertEq(registry.operator(), right);
    }

    function test_proposeRejectsZeroAddress() public {
        vm.prank(operator);
        vm.expectRevert(MarketErrors.ZeroAddress.selector);
        registry.proposeOperator(address(0));
    }

    function test_operatorMayRotateKeeper() public {
        address newKeeper = makeAddr("newKeeper");
        vm.prank(operator);
        registry.setKeeper(newKeeper);
        assertEq(registry.keeper(), newKeeper);

        _register(POOL);
        vm.prank(keeper);
        vm.expectRevert(MarketErrors.NotKeeper.selector);
        registry.updateMarket(POOL, 1, 1, I.EventState.LIVE);
    }

    function test_keeperCannotRotateItself() public {
        vm.prank(keeper);
        vm.expectRevert(MarketErrors.NotOperator.selector);
        registry.setKeeper(stranger);
    }
}
