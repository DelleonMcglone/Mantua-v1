// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Purpose: B4-001/002/004/005 — the Resolver contract. Outcome by market id,
// signer authority with operator override, void path, permissionless freeze
// forwarding, and the one-time factory wiring.

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/test/utils/mocks/MockERC20.sol";
import {Market} from "../../src/markets/Market.sol";
import {MarketFactory} from "../../src/markets/MarketFactory.sol";
import {Resolver} from "../../src/markets/Resolver.sol";

contract ResolverTest is Test {
    MockERC20 usdc;
    Resolver resolver;
    MarketFactory factory;
    Market market;

    address operator = makeAddr("operator");
    address signer = makeAddr("signer");
    address alice = makeAddr("alice");

    bytes32 constant MARKET_ID = keccak256("nfl-401671789-moneyline-0");
    uint64 startsAt;

    function setUp() public {
        vm.warp(1_000_000);
        startsAt = uint64(block.timestamp + 1 days);
        usdc = new MockERC20("USD Coin", "USDC", 6);

        // Deploy order matters: markets burn their resolver address in as an
        // immutable, so the Resolver contract must exist before the factory.
        resolver = new Resolver(operator, signer);
        factory = new MarketFactory(usdc, address(resolver));
        vm.prank(operator);
        resolver.setFactory(factory);

        market = factory.createMarket(MARKET_ID, startsAt, "NFL Chiefs");

        usdc.mint(alice, 1_000e6);
        vm.prank(alice);
        usdc.approve(address(market), type(uint256).max);
    }

    function _openPosition() internal {
        vm.prank(alice);
        market.split(100e6);
    }

    // ─── Wiring (setFactory) ─────────────────────────────────────────────

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(Resolver.ZeroAddress.selector);
        new Resolver(address(0), signer);
        vm.expectRevert(Resolver.ZeroAddress.selector);
        new Resolver(operator, address(0));
    }

    function test_factoryIsSetOnceAndOnlyByOperator() public {
        Resolver fresh = new Resolver(operator, signer);

        vm.prank(alice);
        vm.expectRevert(Resolver.NotOperator.selector);
        fresh.setFactory(factory);

        vm.prank(operator);
        fresh.setFactory(factory);

        // A mutable factory pointer would let a future operator re-aim the
        // resolver at a different market set; once is enough, forever.
        vm.prank(operator);
        vm.expectRevert(Resolver.FactoryAlreadySet.selector);
        fresh.setFactory(factory);
    }

    function test_actionsRevertBeforeFactoryIsSet() public {
        Resolver fresh = new Resolver(operator, signer);
        vm.prank(signer);
        vm.expectRevert(Resolver.FactoryNotSet.selector);
        fresh.resolve(MARKET_ID, 0);
    }

    // ─── Freeze forwarding (B4-002) ──────────────────────────────────────

    function test_freezeByIdIsPermissionlessAfterKickoff() public {
        vm.warp(startsAt);
        vm.prank(alice); // deliberately not signer or operator
        resolver.freeze(MARKET_ID);
        assertEq(uint8(market.state()), uint8(Market.State.FROZEN));
    }

    function test_freezeByIdRejectsUnknownMarket() public {
        vm.warp(startsAt);
        vm.expectRevert(Resolver.UnknownMarket.selector);
        resolver.freeze(keccak256("never-created"));
    }

    // ─── Resolve (B4-001) ────────────────────────────────────────────────

    function test_signerResolvesByMarketId() public {
        _openPosition();
        vm.warp(startsAt);
        resolver.freeze(MARKET_ID);

        vm.expectEmit(true, true, false, true);
        emit Resolver.MarketResolved(MARKET_ID, address(market), 0, signer);
        vm.prank(signer);
        resolver.resolve(MARKET_ID, 0);

        assertEq(uint8(market.state()), uint8(Market.State.RESOLVED));
        assertEq(market.winningOutcome(), 0);
    }

    function test_operatorOverrideCanResolveWithoutTheSigner() public {
        // B4-004: the manual override. A lost or wedged automation key must
        // not leave a finished game unresolvable.
        _openPosition();
        vm.warp(startsAt);
        resolver.freeze(MARKET_ID);

        vm.prank(operator);
        resolver.resolve(MARKET_ID, 1);
        assertEq(market.winningOutcome(), 1);
    }

    function test_strangerCannotResolve() public {
        vm.warp(startsAt);
        resolver.freeze(MARKET_ID);

        vm.prank(alice);
        vm.expectRevert(Resolver.NotAuthorized.selector);
        resolver.resolve(MARKET_ID, 0);
    }

    function test_resolveUnknownMarketReverts() public {
        vm.prank(signer);
        vm.expectRevert(Resolver.UnknownMarket.selector);
        resolver.resolve(keccak256("never-created"), 0);
    }

    function test_marketStateMachineStillGoverns() public {
        // The Resolver forwards; it does not get to skip the market's own
        // guards. Resolve-before-freeze must still be impossible through it.
        vm.prank(signer);
        vm.expectRevert(Market.NotFrozen.selector);
        resolver.resolve(MARKET_ID, 0);
    }

    // ─── Void (B4-005) ───────────────────────────────────────────────────

    function test_signerVoidsAndHoldersRedeemAtCost() public {
        _openPosition();

        vm.expectEmit(true, true, false, true);
        emit Resolver.MarketVoided(MARKET_ID, address(market), signer);
        vm.prank(signer);
        resolver.voidMarket(MARKET_ID);

        assertEq(uint8(market.state()), uint8(Market.State.INVALID));
        vm.prank(alice);
        market.redeemInvalid();
        assertEq(usdc.balanceOf(alice), 1_000e6, "full set redeems at cost");
    }

    function test_operatorCanVoidAFrozenMarket() public {
        // A game abandoned mid-play: frozen at kickoff, then called off.
        vm.warp(startsAt);
        resolver.freeze(MARKET_ID);
        vm.prank(operator);
        resolver.voidMarket(MARKET_ID);
        assertEq(uint8(market.state()), uint8(Market.State.INVALID));
    }

    function test_strangerCannotVoid() public {
        vm.prank(alice);
        vm.expectRevert(Resolver.NotAuthorized.selector);
        resolver.voidMarket(MARKET_ID);
    }

    // ─── Roles ───────────────────────────────────────────────────────────

    function test_operatorRotatesTheSigner() public {
        address next = makeAddr("nextSigner");
        vm.prank(operator);
        resolver.setSigner(next);

        vm.warp(startsAt);
        resolver.freeze(MARKET_ID);

        vm.prank(signer);
        vm.expectRevert(Resolver.NotAuthorized.selector);
        resolver.resolve(MARKET_ID, 0);

        vm.prank(next);
        resolver.resolve(MARKET_ID, 0);
    }

    function test_signerCannotRotateItself() public {
        vm.prank(signer);
        vm.expectRevert(Resolver.NotOperator.selector);
        resolver.setSigner(alice);
    }

    function test_operatorTransferIsTwoStep() public {
        address next = makeAddr("nextOperator");
        vm.prank(operator);
        resolver.proposeOperator(next);
        assertEq(resolver.operator(), operator, "not transferred until accepted");

        vm.prank(alice);
        vm.expectRevert(Resolver.NotPendingOperator.selector);
        resolver.acceptOperator();

        vm.prank(next);
        resolver.acceptOperator();
        assertEq(resolver.operator(), next);

        // The new operator inherits the override (B4-007 will swap this for a
        // multisig once DM-103 closes; the seat itself already rotates).
        vm.warp(startsAt);
        resolver.freeze(MARKET_ID);
        vm.prank(next);
        resolver.resolve(MARKET_ID, 0);
    }
}
