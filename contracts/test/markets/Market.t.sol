// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/test/utils/mocks/MockERC20.sol";
import {Market} from "../../src/markets/Market.sol";
import {MarketFactory} from "../../src/markets/MarketFactory.sol";
import {OutcomeToken} from "../../src/markets/OutcomeToken.sol";
import {RiskPolicy} from "../../src/hooks/dynamic-market/RiskPolicy.sol";

/// @notice B1-007 — unit tests for the market primitives.
///         Split/merge round trip, collateral solvency, resolve-before-freeze
///         rejection, double-redeem rejection, plus the lifecycle guards from
///         `docs/specs/market-lifecycle.md`.
contract MarketTest is Test {
    MockERC20 usdc;
    MarketFactory factory;
    Market market;
    // Cached: `yes` is itself a call, so writing it inline
    // after `vm.prank` consumes the prank on the getter instead of the
    // transfer that follows.
    OutcomeToken yes;
    OutcomeToken no;

    address resolver = makeAddr("resolver");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    bytes32 constant MARKET_ID = keccak256("nfl-401671789-moneyline-0");
    uint64 startsAt;

    function setUp() public {
        // USDC is 6 decimals on Base (B1-006).
        usdc = new MockERC20("USD Coin", "USDC", 6);
        factory = new MarketFactory(usdc, resolver);

        startsAt = uint64(block.timestamp + 1 days);
        market = factory.createMarket(MARKET_ID, startsAt, "NFL Chiefs");
        yes = market.yesToken();
        no = market.noToken();

        usdc.mint(alice, 1000e6);
        usdc.mint(bob, 1000e6);

        vm.prank(alice);
        usdc.approve(address(market), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(market), type(uint256).max);
    }

    // ─── Construction ────────────────────────────────────────────────────

    function test_outcomeTokensInheritCollateralDecimals() public view {
        // B1-006: one outcome token is exactly one unit of collateral, so no
        // scaling is needed anywhere in split/merge/redeem.
        assertEq(yes.decimals(), 6);
        assertEq(no.decimals(), 6);
    }

    function test_marketStartsOpen() public view {
        assertEq(uint8(market.state()), uint8(Market.State.OPEN));
        assertTrue(market.isTradeable());
    }

    function test_factoryRejectsDuplicateMarketId() public {
        vm.expectRevert(MarketFactory.MarketExists.selector);
        factory.createMarket(MARKET_ID, startsAt, "NFL Chiefs");
    }

    function test_factoryIsIdempotentWhenAsked() public {
        (Market existing, bool created) = factory.createMarketIfAbsent(MARKET_ID, startsAt, "NFL Chiefs");
        assertEq(address(existing), address(market));
        assertFalse(created);
        assertEq(factory.marketCount(), 1);
    }

    function test_factoryRejectsMarketStartingInThePast() public {
        vm.expectRevert(MarketFactory.StartInPast.selector);
        factory.createMarket(keccak256("past"), uint64(block.timestamp), "Yesterday");
    }

    function test_onlyMarketCanMintOutcomeTokens() public {
        vm.prank(alice);
        vm.expectRevert(OutcomeToken.OnlyMarket.selector);
        yes.mint(alice, 1e6);
    }

    // ─── Split / merge ───────────────────────────────────────────────────

    function test_splitMintsBothSidesAndTakesCollateral() public {
        vm.prank(alice);
        market.split(100e6);

        assertEq(yes.balanceOf(alice), 100e6);
        assertEq(no.balanceOf(alice), 100e6);
        assertEq(usdc.balanceOf(alice), 900e6);
        assertEq(usdc.balanceOf(address(market)), 100e6);
        assertEq(market.outstandingSets(), 100e6);
    }

    function test_splitMergeRoundTripsExactly() public {
        uint256 before = usdc.balanceOf(alice);

        vm.startPrank(alice);
        market.split(100e6);
        market.merge(100e6);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice), before, "round trip must be lossless");
        assertEq(yes.balanceOf(alice), 0);
        assertEq(no.balanceOf(alice), 0);
        assertEq(market.outstandingSets(), 0);
        assertEq(market.collateralSurplus(), 0);
    }

    function test_mergeRequiresBothSides() public {
        vm.startPrank(alice);
        market.split(100e6);
        yes.transfer(bob, 100e6);
        // Alice holds NO but no YES — the merge must fail rather than
        // returning collateral against half a set.
        vm.expectRevert();
        market.merge(100e6);
        vm.stopPrank();
    }

    function test_splitRejectsZero() public {
        vm.prank(alice);
        vm.expectRevert(Market.ZeroAmount.selector);
        market.split(0);
    }

    // ─── Freeze (in-play semantics, D-103) ───────────────────────────────

    function test_freezeRejectedBeforeKickoffOnBothPaths() public {
        // Even the resolver cannot close a market people are still pricing
        // pre-game; a called-off game is void's job.
        vm.prank(resolver);
        vm.expectRevert(Market.TooEarlyToFreeze.selector);
        market.freeze();

        vm.prank(alice);
        vm.expectRevert(Market.TooEarlyToFreeze.selector);
        market.freeze();
    }

    function test_resolverFreezesFromKickoff() public {
        // The data-driven freeze: the resolver closes trading on "final" (or
        // any time the event is underway).
        vm.warp(startsAt);
        vm.prank(resolver);
        market.freeze();
        assertEq(uint8(market.state()), uint8(Market.State.FROZEN));
        assertFalse(market.isTradeable());
    }

    function test_strangerCannotFreezeDuringTheEventWindow() public {
        // In-play trading: kickoff no longer opens a permissionless freeze.
        // A griefer must not be able to close a live market early.
        vm.warp(startsAt);
        vm.prank(alice);
        vm.expectRevert(Market.TooEarlyToFreeze.selector);
        market.freeze();

        vm.warp(startsAt + market.MAX_EVENT_DURATION() - 1);
        vm.prank(alice);
        vm.expectRevert(Market.TooEarlyToFreeze.selector);
        market.freeze();
    }

    function test_freezeIsPermissionlessAfterTheBackstop() public {
        // Deliberately not the resolver: past startsAt + MAX_EVENT_DURATION
        // the event cannot still be running, and a market must not stay
        // tradeable forever because the service is down.
        vm.warp(startsAt + market.MAX_EVENT_DURATION());
        vm.prank(alice);
        market.freeze();
        assertEq(uint8(market.state()), uint8(Market.State.FROZEN));
        assertFalse(market.isTradeable());
    }

    function test_tradingStaysOpenDuringTheGame() public {
        // The point of D-103: split/merge (and swaps, gated by the hook) run
        // through the event until the resolver freezes on final.
        vm.warp(startsAt + 1 hours);
        assertTrue(market.isTradeable());

        vm.startPrank(alice);
        market.split(100e6);
        market.merge(40e6);
        vm.stopPrank();
        assertEq(market.outstandingSets(), 60e6);
    }

    function test_backstopMatchesTheHook() public view {
        // The market's permissionless freeze() must unlock at the same
        // instant the hook's time backstop halts swaps — one clock, two
        // enforcement layers (D-103).
        assertEq(market.MAX_EVENT_DURATION(), RiskPolicy.MAX_EVENT_DURATION, "market and hook backstops diverged");
    }

    function test_isTradeableFalsePastBackstopEvenBeforeAnyoneFreezes() public {
        // The view must not report an un-frozen zombie as tradeable — the
        // hook has already halted swaps on the same clock.
        vm.warp(startsAt + market.MAX_EVENT_DURATION());
        assertEq(uint8(market.state()), uint8(Market.State.OPEN));
        assertFalse(market.isTradeable());
    }

    function test_splitAndMergeCloseAtFreeze() public {
        vm.prank(alice);
        market.split(100e6);

        vm.warp(startsAt);
        vm.prank(resolver);
        market.freeze();

        // Minting sets against a known result must be impossible.
        vm.startPrank(alice);
        vm.expectRevert(Market.NotOpen.selector);
        market.split(10e6);
        vm.expectRevert(Market.NotOpen.selector);
        market.merge(10e6);
        vm.stopPrank();
    }

    // ─── Resolve ─────────────────────────────────────────────────────────

    function test_resolveBeforeFreezeIsRejected() public {
        // B1-007 — an outcome cannot be submitted while trading is open.
        vm.prank(resolver);
        vm.expectRevert(Market.NotFrozen.selector);
        market.resolve(0);
    }

    function test_onlyResolverMayResolve() public {
        vm.warp(startsAt);
        vm.prank(resolver);
        market.freeze();

        vm.prank(alice);
        vm.expectRevert(Market.OnlyResolver.selector);
        market.resolve(0);
    }

    function test_resolveRejectsOutOfRangeOutcome() public {
        vm.warp(startsAt);
        vm.prank(resolver);
        market.freeze();

        vm.prank(resolver);
        vm.expectRevert(Market.InvalidOutcome.selector);
        market.resolve(2);
    }

    function test_cannotResolveTwice() public {
        _freezeAndResolve(0);

        vm.prank(resolver);
        vm.expectRevert(Market.NotFrozen.selector);
        market.resolve(1);
    }

    // ─── Redeem ──────────────────────────────────────────────────────────

    function test_winnerRedeemsOneForOne() public {
        vm.prank(alice);
        market.split(100e6);
        _freezeAndResolve(0); // YES wins

        vm.prank(alice);
        market.redeem();

        assertEq(usdc.balanceOf(alice), 1000e6, "made whole on the winning side");
        assertEq(yes.balanceOf(alice), 0);
        // Losing tokens are left in place as a record of the position.
        assertEq(no.balanceOf(alice), 100e6);
    }

    function test_loserRedeemsNothing() public {
        vm.prank(alice);
        market.split(100e6);
        vm.prank(alice);
        yes.transfer(bob, 100e6);

        _freezeAndResolve(1); // NO wins — bob holds only YES

        vm.prank(bob);
        vm.expectRevert(Market.NothingToRedeem.selector);
        market.redeem();
    }

    function test_doubleRedeemIsRejected() public {
        // B1-007 — the second call finds a zero balance.
        vm.prank(alice);
        market.split(100e6);
        _freezeAndResolve(0);

        vm.startPrank(alice);
        market.redeem();
        vm.expectRevert(Market.NothingToRedeem.selector);
        market.redeem();
        vm.stopPrank();
    }

    function test_redeemBlockedBeforeResolution() public {
        vm.prank(alice);
        market.split(100e6);

        vm.prank(alice);
        vm.expectRevert(Market.NotRedeemable.selector);
        market.redeem();
    }

    function test_marketSettlesWhenFullyRedeemed() public {
        vm.prank(alice);
        market.split(100e6);
        _freezeAndResolve(0);

        vm.prank(alice);
        market.redeem();

        assertEq(uint8(market.state()), uint8(Market.State.SETTLED));
        assertEq(market.outstandingSets(), 0);
        assertEq(usdc.balanceOf(address(market)), 0, "no collateral stranded");
    }

    function test_redemptionStaysOpenAfterSettlement() public {
        // SETTLED is bookkeeping, not a gate — a late claimant can still claim.
        vm.prank(alice);
        market.split(100e6);
        vm.prank(alice);
        yes.transfer(bob, 40e6);

        _freezeAndResolve(0);

        vm.prank(alice);
        market.redeem(); // 60 of 100 — not yet drained

        vm.prank(bob);
        market.redeem(); // drains, settles
        assertEq(uint8(market.state()), uint8(Market.State.SETTLED));
        assertEq(usdc.balanceOf(bob), 1040e6);
    }

    function test_twoHoldersSplitCollateralExactly() public {
        vm.prank(alice);
        market.split(100e6);
        vm.prank(alice);
        yes.transfer(bob, 30e6);

        _freezeAndResolve(0);

        vm.prank(bob);
        market.redeem();
        vm.prank(alice);
        market.redeem();

        assertEq(usdc.balanceOf(address(market)), 0);
        assertEq(usdc.balanceOf(bob), 1030e6);
        assertEq(usdc.balanceOf(alice), 970e6);
    }

    // ─── Void ────────────────────────────────────────────────────────────

    function test_voidReturnsCollateralToSetHolder() public {
        vm.prank(alice);
        market.split(100e6);

        vm.prank(resolver);
        market.voidMarket();
        assertEq(uint8(market.state()), uint8(Market.State.INVALID));

        vm.prank(alice);
        market.redeemInvalid();

        assertEq(usdc.balanceOf(alice), 1000e6, "a full set returns what it cost");
        assertEq(usdc.balanceOf(address(market)), 0);
    }

    function test_voidPaysHalfPerLooseToken() public {
        vm.prank(alice);
        market.split(100e6);
        vm.prank(alice);
        yes.transfer(bob, 40e6);

        vm.prank(resolver);
        market.voidMarket();

        vm.prank(bob);
        market.redeemInvalid();
        // 40 YES → 20 USDC. Bob bought those tokens from Alice; the void
        // splits the collateral by tokens held, not by what was paid.
        assertEq(usdc.balanceOf(bob), 1020e6);

        vm.prank(alice);
        market.redeemInvalid();
        assertEq(usdc.balanceOf(alice), 980e6);
        assertEq(usdc.balanceOf(address(market)), 0, "collateral fully returned");
    }

    function test_onlyResolverMayVoid() public {
        vm.prank(alice);
        vm.expectRevert(Market.OnlyResolver.selector);
        market.voidMarket();
    }

    function test_cannotVoidAResolvedMarket() public {
        _freezeAndResolve(0);
        vm.prank(resolver);
        vm.expectRevert(Market.NotOpen.selector);
        market.voidMarket();
    }

    function test_normalRedeemBlockedOnVoidMarket() public {
        vm.prank(alice);
        market.split(100e6);
        vm.prank(resolver);
        market.voidMarket();

        vm.prank(alice);
        vm.expectRevert(Market.NotRedeemable.selector);
        market.redeem();
    }

    // ─── Solvency ────────────────────────────────────────────────────────

    function test_collateralNeverBelowOutstandingAcrossLifecycle() public {
        // B1-007 solvency invariant, checked at every step.
        assertGe(market.collateralSurplus(), 0);

        vm.prank(alice);
        market.split(100e6);
        assertGe(market.collateralSurplus(), 0);

        vm.prank(bob);
        market.split(50e6);
        assertGe(market.collateralSurplus(), 0);

        vm.prank(alice);
        market.merge(30e6);
        assertGe(market.collateralSurplus(), 0);

        _freezeAndResolve(0);
        assertGe(market.collateralSurplus(), 0);

        vm.prank(alice);
        market.redeem();
        assertGe(market.collateralSurplus(), 0);

        vm.prank(bob);
        market.redeem();
        assertGe(market.collateralSurplus(), 0);
        assertEq(usdc.balanceOf(address(market)), 0);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _freezeAndResolve(uint8 outcome) private {
        // The data-driven path: the resolver freezes on final, then resolves.
        vm.warp(startsAt);
        vm.prank(resolver);
        market.freeze();
        vm.prank(resolver);
        market.resolve(outcome);
    }
}
