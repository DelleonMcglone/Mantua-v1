// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/test/utils/mocks/MockERC20.sol";
import {Market} from "../../src/markets/Market.sol";
import {MarketFactory} from "../../src/markets/MarketFactory.sol";
import {OutcomeToken} from "../../src/markets/OutcomeToken.sol";

/// @notice Actor the invariant fuzzer drives. Holds a fixed cast of users and
///         exposes only the operations a real participant can perform, so the
///         fuzzer explores reachable states rather than impossible ones.
contract MarketHandler is Test {
    Market public market;
    MockERC20 public usdc;
    OutcomeToken public yes;
    OutcomeToken public no;

    address[3] public actors;

    /// @notice Sum of every payout the market has made. Used to check that
    ///         the market never pays out more than was ever put in.
    uint256 public totalPaidOut;
    uint256 public totalDeposited;

    constructor(Market market_, MockERC20 usdc_) {
        market = market_;
        usdc = usdc_;
        yes = market_.yesToken();
        no = market_.noToken();

        actors[0] = makeAddr("fuzz_alice");
        actors[1] = makeAddr("fuzz_bob");
        actors[2] = makeAddr("fuzz_carol");

        for (uint256 i = 0; i < actors.length; i++) {
            usdc_.mint(actors[i], 1_000_000e6);
            vm.prank(actors[i]);
            usdc_.approve(address(market_), type(uint256).max);
        }
    }

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    function split(uint256 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);
        amount = bound(amount, 1, usdc.balanceOf(actor));
        if (amount == 0) return;

        vm.prank(actor);
        try market.split(amount) {
            totalDeposited += amount;
        } catch {
            // State-guard rejections are expected; the fuzzer explores them.
        }
    }

    function merge(uint256 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);
        uint256 max = _min(yes.balanceOf(actor), no.balanceOf(actor));
        if (max == 0) return;
        amount = bound(amount, 1, max);

        uint256 before = usdc.balanceOf(actor);
        vm.prank(actor);
        try market.merge(amount) {
            totalPaidOut += usdc.balanceOf(actor) - before;
        } catch {}
    }

    /// @notice Move outcome tokens between actors — this is what a pool swap
    ///         looks like from the market's point of view, and it is the case
    ///         where naive collateral accounting breaks.
    function transferYes(uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        address from = _actor(fromSeed);
        address to = _actor(toSeed);
        uint256 max = yes.balanceOf(from);
        if (max == 0 || from == to) return;
        amount = bound(amount, 1, max);

        vm.prank(from);
        yes.transfer(to, amount);
    }

    function transferNo(uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        address from = _actor(fromSeed);
        address to = _actor(toSeed);
        uint256 max = no.balanceOf(from);
        if (max == 0 || from == to) return;
        amount = bound(amount, 1, max);

        vm.prank(from);
        no.transfer(to, amount);
    }

    function freeze() external {
        vm.warp(market.startsAt());
        try market.freeze() {} catch {}
    }

    function resolve(uint256 outcomeSeed) external {
        vm.prank(market.resolver());
        try market.resolve(uint8(outcomeSeed % 2)) {} catch {}
    }

    function redeem(uint256 actorSeed) external {
        address actor = _actor(actorSeed);
        uint256 before = usdc.balanceOf(actor);
        vm.prank(actor);
        try market.redeem() {
            totalPaidOut += usdc.balanceOf(actor) - before;
        } catch {}
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}

/// @notice B1-008 — the collateral solvency invariant, fuzzed.
///
///         The property under test: the market can never owe more than it
///         holds. Everything else about the design is negotiable; this is
///         not, because breaking it means a holder cannot be paid.
contract MarketInvariantTest is Test {
    MockERC20 usdc;
    MarketFactory factory;
    Market market;
    MarketHandler handler;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        factory = new MarketFactory(usdc, makeAddr("resolver"));
        market = factory.createMarket(keccak256("fuzz-market"), uint64(block.timestamp + 1 days), "Fuzz");

        handler = new MarketHandler(market, usdc);
        targetContract(address(handler));
    }

    /// @notice Collateral held ≥ what holders can redeem, at every reachable
    ///         state. This is the invariant B1-008 exists to defend.
    function invariant_collateralCoversOutstandingSets() public view {
        assertGe(
            usdc.balanceOf(address(market)),
            market.outstandingSets(),
            "collateral fell below outstanding redeemable supply"
        );
    }

    /// @notice While OPEN, every set has exactly one YES and one NO — the
    ///         supplies cannot drift apart, because split and merge only ever
    ///         move them together.
    function invariant_outcomeSuppliesMatchWhileOpen() public view {
        if (market.state() != Market.State.OPEN) return;
        assertEq(
            market.yesToken().totalSupply(), market.noToken().totalSupply(), "YES and NO supply diverged while open"
        );
        assertEq(market.yesToken().totalSupply(), market.outstandingSets(), "supply drifted from the set count");
    }

    /// @notice The market never pays out more than was ever deposited. A
    ///         weaker statement than the balance check above, but it catches
    ///         a different failure — one where collateral is topped up from
    ///         somewhere else and masks an over-payment.
    function invariant_neverPaysOutMoreThanDeposited() public view {
        assertLe(handler.totalPaidOut(), handler.totalDeposited(), "market paid out more than it took in");
    }

    /// @notice Redemption liability is bounded by the winning side's supply.
    function invariant_outstandingNeverExceedsWinningSupply() public view {
        Market.State state = market.state();
        if (state != Market.State.RESOLVED && state != Market.State.SETTLED) return;

        OutcomeToken winner = market.winningOutcome() == 0 ? market.yesToken() : market.noToken();
        assertEq(
            market.outstandingSets(), winner.totalSupply(), "outstanding sets diverged from redeemable winning supply"
        );
    }
}
