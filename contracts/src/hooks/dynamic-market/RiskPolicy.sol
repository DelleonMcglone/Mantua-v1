// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title RiskPolicy
/// @notice PURPOSE: the immutable protocol bounds for the Dynamic Market Hook,
///         plus pure checks that clamp against them. Spec §27; fee bounds per
///         the D-105 fee model. Every fee-rate and trade-cap path resolves here.
///
/// @dev Nothing in this library is settable, and no contract exposes a path to
///      change these values. That is the point: spec §44 makes it a failure
///      condition if a keeper or governor can raise the fee ceiling or
///      `ABS_MAX_TRADE`, so they are `constant`, not storage. Lifting the
///      0.70% ceiling requires a redeploy (H-002).
///
///      **Two unit systems meet here, and mixing them is the trap.** Fees are
///      in Uniswap v4 pips, where 1_000_000 == 100%. Probability and
///      confidence (spec §10, §12) are in basis points, where 10_000 == 100%.
///      A value that looks like a plausible fee is a wildly wrong probability
///      and vice versa. Fee-shaped values never leave this library in bps.
library RiskPolicy {
    // ─── Fee-rate bounds (v4 pips: 1_000_000 == 100%) ────────────────────

    /// @notice The regular-season fee — 0%. D-105: adoption first.
    uint24 internal constant REGULAR_SEASON_FEE = 0;

    /// @notice Floor of the playoff dynamic rate — 0.10%. D-105.
    uint24 internal constant MIN_RATE = 1000;

    /// @notice Ceiling of the playoff dynamic rate — 0.70%. D-105 (H-002).
    ///         Mantua never exceeds this; a stale keeper clamps here (§22).
    uint24 internal constant MAX_RATE = 7000;

    // ─── Trade-cap bounds (USDC notional, 6 decimals) ────────────────────

    /// @notice Hard ceiling on any single swap — $10,000. Spec §21.
    uint256 internal constant ABS_MAX_TRADE = 10_000e6;

    /// @notice Floor the dynamic cap may fall to — $100. Spec §21, §22.
    uint256 internal constant MIN_TRADE_CAP = 100e6;

    // ─── Timings (seconds) ───────────────────────────────────────────────

    /// @notice Keeper state older than this is stale. Spec §22.
    uint64 internal constant STALE_AFTER = 900;

    /// @notice How long after kickoff the time backstop allows trading —
    ///         in-play trading runs through the game (D-103), and this is the
    ///         longest any event can possibly run. Spec §6.
    /// @dev Must equal `Market.MAX_EVENT_DURATION`: the market's
    ///      permissionless `freeze()` unlocks at the same instant this
    ///      backstop halts swaps, so the two layers agree about when an
    ///      abandoned market closed.
    uint64 internal constant MAX_EVENT_DURATION = 12 hours;

    // ─── Pure checks ─────────────────────────────────────────────────────

    /// @notice Clamp a computed playoff rate into `[MIN_RATE, MAX_RATE]`.
    /// @dev The single choke point for the "rate below the floor" and "rate
    ///      above the ceiling" failure conditions — premium arithmetic may
    ///      overshoot as long as it passes through here. Regular-season
    ///      pools never reach this function: the season gate short-circuits
    ///      to `REGULAR_SEASON_FEE` before any rate is computed.
    function clampRate(uint24 rate) internal pure returns (uint24) {
        if (rate < MIN_RATE) return MIN_RATE;
        if (rate > MAX_RATE) return MAX_RATE;
        return rate;
    }

    /// @notice Clamp a computed trade cap into
    ///         `[MIN_TRADE_CAP, ABS_MAX_TRADE]`. Spec §21.
    function clampTradeCap(uint256 cap) internal pure returns (uint256) {
        if (cap < MIN_TRADE_CAP) return MIN_TRADE_CAP;
        if (cap > ABS_MAX_TRADE) return ABS_MAX_TRADE;
        return cap;
    }

    /// @notice Whether keeper state is stale. Spec §22.
    /// @param lastUpdate Timestamp of the keeper's last valid write. Zero means
    ///        never written.
    /// @param nowTs Current block timestamp.
    /// @dev A never-written pool is stale, so a registered-but-unfed market
    ///      fails closed rather than reading as fresh at timestamp zero. A
    ///      `lastUpdate` in the future returns fresh rather than underflowing.
    function isStale(uint64 lastUpdate, uint64 nowTs) internal pure returns (bool) {
        if (lastUpdate == 0) return true;
        if (nowTs <= lastUpdate) return false;
        return nowTs - lastUpdate > STALE_AFTER;
    }

    /// @notice Whether the time backstop has fired: the event cannot still be
    ///         running, so trading halts even if the keeper never wrote
    ///         `FINAL`. Spec §6 (D-103 semantics).
    /// @dev Depends only on the registration timestamp and the block clock —
    ///      never on keeper liveness, which is spec §44's "freeze depends on
    ///      a keeper update" failure condition. Subtraction rather than
    ///      addition so a kickoff near `type(uint64).max` cannot overflow
    ///      into a market that never closes.
    function isPastBackstop(uint64 kickoffTimestamp, uint64 nowTs) internal pure returns (bool) {
        if (nowTs < kickoffTimestamp) return false;
        return nowTs - kickoffTimestamp >= MAX_EVENT_DURATION;
    }
}
