// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "solmate/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/utils/SafeTransferLib.sol";
import {OutcomeToken} from "./OutcomeToken.sol";

/// @title Market
/// @notice A single binary prediction market: YES/NO outcome tokens fully
///         collateralised 1:1 by USDC, with a lifecycle that runs
///         OPEN → FROZEN → RESOLVED → SETTLED, or diverts to INVALID.
///         Trading is in-play (D-103): OPEN runs through the game, the
///         resolver freezes on final, and a permissionless time backstop at
///         `startsAt + MAX_EVENT_DURATION` catches a downed service.
///
/// @dev Implements B1-001 … B1-006. Behaviour is specified in
///      `docs/specs/market-lifecycle.md`; the state table there is the
///      authority for what each state permits.
///
///      **The invariant.** Collateral held is always ≥ what holders can
///      redeem. Every entry point below preserves it:
///        - `split`  pulls 1 USDC and mints one YES + one NO. One *set* is
///                   redeemable for 1 USDC, so liability rises exactly with
///                   collateral.
///        - `merge`  burns a set and returns 1 USDC. Both fall together.
///        - `redeem` burns winning tokens 1:1 and pays out; losing tokens
///                   are worth nothing, so the collateral backing them was
///                   already covering the winning side.
///        - `redeemInvalid` pays 0.5 per token, so a full set still returns
///                   exactly the 1 USDC it was minted with.
///      Tested in `test/markets/Market.t.sol` and fuzzed in
///      `test/markets/MarketInvariant.t.sol`.
contract Market {
    using SafeTransferLib for ERC20;

    /// @notice Lifecycle states. One-way transitions only — see §2 of the spec.
    enum State {
        OPEN,
        FROZEN,
        RESOLVED,
        SETTLED,
        INVALID
    }

    /// @notice How long after `startsAt` an event can possibly run. Past
    ///         `startsAt + MAX_EVENT_DURATION` anyone may freeze — the
    ///         permissionless backstop that guarantees no market outlives its
    ///         event if the resolution service is down (D-103). A constant,
    ///         not a per-market value: the factory passes no duration and no
    ///         NFL game approaches 12 hours.
    uint64 public constant MAX_EVENT_DURATION = 12 hours;

    /// @notice Deterministic id from `server/src/lib/market-id.ts` (B0-004).
    bytes32 public immutable marketId;
    /// @notice USDC. 6-decimal ERC-20 on Base.
    ERC20 public immutable collateral;
    OutcomeToken public immutable yesToken;
    OutcomeToken public immutable noToken;
    /// @notice Scheduled kickoff. Anchors the freeze backstop; trading stays
    ///         open through the game itself (in-play trading, D-103).
    uint64 public immutable startsAt;
    /// @notice May freeze (data-driven, from kickoff), resolve, and void.
    ///         The Resolver contract per D-104.
    address public immutable resolver;

    State public state;
    /// @notice 0 = YES won, 1 = NO won. Only meaningful once RESOLVED.
    uint8 public winningOutcome;
    /// @notice Outstanding sets — the number of YES/NO pairs ever minted and
    ///         not yet merged. Collateral held must never fall below this.
    uint256 public outstandingSets;

    event Split(address indexed account, uint256 amount);
    event Merge(address indexed account, uint256 amount);
    event Frozen(uint64 frozenAt);
    event Resolved(uint8 winningOutcome);
    event Voided();
    event Redeemed(address indexed account, uint256 tokensBurned, uint256 payout);
    event Settled();

    error OnlyResolver();
    error NotOpen();
    error NotFrozen();
    error NotRedeemable();
    error TooEarlyToFreeze();
    error ZeroAmount();
    error InvalidOutcome();
    error NothingToRedeem();

    modifier onlyResolver() {
        if (msg.sender != resolver) revert OnlyResolver();
        _;
    }

    constructor(bytes32 marketId_, ERC20 collateral_, uint64 startsAt_, address resolver_, string memory label) {
        marketId = marketId_;
        collateral = collateral_;
        startsAt = startsAt_;
        resolver = resolver_;
        state = State.OPEN;

        uint8 dec = collateral_.decimals();
        yesToken = new OutcomeToken(string.concat(label, " YES"), "YES", dec, address(this));
        noToken = new OutcomeToken(string.concat(label, " NO"), "NO", dec, address(this));
    }

    // ─── Trading primitives ──────────────────────────────────────────────

    /// @notice B1-002. Deposit `amount` USDC, receive `amount` YES + `amount` NO.
    /// @dev Fee-free by design: fees are the hook's job, on the swap path only.
    function split(uint256 amount) external {
        if (state != State.OPEN) revert NotOpen();
        if (amount == 0) revert ZeroAmount();

        // Pull first, then mint — collateral is in hand before any liability
        // is created, so the invariant holds even if the token is unusual.
        collateral.safeTransferFrom(msg.sender, address(this), amount);
        outstandingSets += amount;
        yesToken.mint(msg.sender, amount);
        noToken.mint(msg.sender, amount);

        emit Split(msg.sender, amount);
    }

    /// @notice B1-003. Burn `amount` YES + `amount` NO, receive `amount` USDC.
    function merge(uint256 amount) external {
        if (state != State.OPEN) revert NotOpen();
        if (amount == 0) revert ZeroAmount();

        // Burn first, then pay out — liability is retired before collateral
        // leaves, so the invariant never dips mid-call.
        yesToken.burn(msg.sender, amount);
        noToken.burn(msg.sender, amount);
        outstandingSets -= amount;
        collateral.safeTransfer(msg.sender, amount);

        emit Merge(msg.sender, amount);
    }

    // ─── Lifecycle ───────────────────────────────────────────────────────

    /// @notice B1-005 / B4-002 / D-103. Close trading when the event is over.
    /// @dev Two paths in, deliberately:
    ///        - The **resolver** may freeze any time from `startsAt` — the
    ///          data-driven freeze on "final" (in-play trading runs through
    ///          the game, so kickoff no longer closes anything).
    ///        - **Anyone** may freeze once `startsAt + MAX_EVENT_DURATION`
    ///          has passed — the time backstop, so no market outlives its
    ///          event when the service is down. Freezing must never depend
    ///          on the resolver being online forever.
    ///      There is no freeze before kickoff on either path: the resolver
    ///      cannot pre-emptively close a market people are still pricing,
    ///      and a called-off game is `voidMarket`'s job, not freeze's.
    function freeze() external {
        if (state != State.OPEN) revert NotOpen();
        uint256 openUntil =
            msg.sender == resolver ? startsAt : uint256(startsAt) + MAX_EVENT_DURATION;
        if (block.timestamp < openUntil) revert TooEarlyToFreeze();

        state = State.FROZEN;
        emit Frozen(uint64(block.timestamp));
    }

    /// @notice B1-005 / B4-001. Record the outcome.
    /// @dev Rejects resolve-before-freeze (B1-007): an outcome cannot be
    ///      submitted while trading is open.
    function resolve(uint8 outcome) external onlyResolver {
        if (state != State.FROZEN) revert NotFrozen();
        if (outcome > 1) revert InvalidOutcome();

        winningOutcome = outcome;
        state = State.RESOLVED;
        emit Resolved(outcome);
    }

    /// @notice B4-005. Void a postponed, cancelled, or abandoned game.
    /// @dev Reachable from OPEN or FROZEN — a game can be called off before
    ///      kickoff as easily as after it.
    function voidMarket() external onlyResolver {
        if (state != State.OPEN && state != State.FROZEN) revert NotOpen();

        state = State.INVALID;
        emit Voided();
    }

    // ─── Redemption ──────────────────────────────────────────────────────

    /// @notice B1-004. Burn winning tokens for 1 USDC each. Losing tokens are
    ///         worth nothing and are left alone rather than burned, so a
    ///         holder keeps a record of the position.
    /// @dev Double-redeem is impossible because the tokens are burned — a
    ///      second call finds a zero balance and reverts (B1-007).
    function redeem() external {
        if (state != State.RESOLVED && state != State.SETTLED) revert NotRedeemable();

        OutcomeToken winner = winningOutcome == 0 ? yesToken : noToken;
        uint256 balance = winner.balanceOf(msg.sender);
        if (balance == 0) revert NothingToRedeem();

        winner.burn(msg.sender, balance);
        outstandingSets -= balance;
        collateral.safeTransfer(msg.sender, balance);

        emit Redeemed(msg.sender, balance, balance);
        _settleIfDrained();
    }

    /// @notice B4-005. On an INVALID market both sides pay 0.5 USDC per token,
    ///         so a full set returns exactly the 1 USDC it was minted with.
    /// @dev Odd amounts round down, leaving at most 1 wei per redemption in
    ///      the contract. That dust is on the safe side of the invariant —
    ///      it can only leave collateral above liability, never below.
    function redeemInvalid() external {
        if (state != State.INVALID) revert NotRedeemable();

        uint256 yesBalance = yesToken.balanceOf(msg.sender);
        uint256 noBalance = noToken.balanceOf(msg.sender);
        uint256 total = yesBalance + noBalance;
        if (total == 0) revert NothingToRedeem();

        if (yesBalance > 0) yesToken.burn(msg.sender, yesBalance);
        if (noBalance > 0) noToken.burn(msg.sender, noBalance);

        uint256 payout = total / 2;
        // Each redeemed set retires one unit of liability. A lone token
        // retires half a set, so track in half-units and divide.
        uint256 setsRetired = total / 2;
        outstandingSets = outstandingSets > setsRetired ? outstandingSets - setsRetired : 0;

        collateral.safeTransfer(msg.sender, payout);
        emit Redeemed(msg.sender, total, payout);
        _settleIfDrained();
    }

    /// @dev SETTLED is bookkeeping, not a gate — redemption stays open
    ///      afterwards so a holder who never claimed still can.
    function _settleIfDrained() private {
        if (outstandingSets == 0 && state != State.SETTLED) {
            state = State.SETTLED;
            emit Settled();
        }
    }

    // ─── Views ───────────────────────────────────────────────────────────

    /// @notice True while swaps are permitted: OPEN and not past the time
    ///         backstop. The hook enforces the same rule from the registry's
    ///         immutable kickoff (B2-003, D-103); this view is the market's
    ///         own honest answer for off-chain readers, so a market awaiting
    ///         its backstop freeze does not report as tradeable.
    function isTradeable() external view returns (bool) {
        return state == State.OPEN && block.timestamp < uint256(startsAt) + MAX_EVENT_DURATION;
    }

    /// @notice Collateral held minus what holders can still redeem. The
    ///         solvency invariant is that this never goes negative, so the
    ///         function returns it as a signed value rather than reverting.
    function collateralSurplus() external view returns (int256) {
        return int256(collateral.balanceOf(address(this))) - int256(outstandingSets);
    }
}
