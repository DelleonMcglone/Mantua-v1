// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title RiskPolicy
/// @notice PURPOSE: the immutable protocol bounds for the Dynamic Market Hook,
///         plus pure checks that clamp against them. Spec §27; values fixed in
///         spec §0.3. Every fee and trade-cap path in the hook resolves here.
///
/// @dev Nothing in this library is settable, and no contract exposes a path to
///      change these values. That is the point: spec §44 makes it a failure
///      condition if a keeper or governor can raise `MAX_FEE` or
///      `ABS_MAX_TRADE`, so they are `constant`, not storage.
///
///      **Two unit systems meet here, and mixing them is the trap.** Fees are
///      in Uniswap v4 pips, where 1_000_000 == 100%. Probability and
///      confidence (spec §10, §12) are in basis points, where 10_000 == 100%.
///      A value that looks like a plausible fee is a wildly wrong probability
///      and vice versa. Fee-shaped values never leave this library in bps.
library RiskPolicy {
    // ─── Fee bounds (v4 pips: 1_000_000 == 100%) ─────────────────────────

    /// @notice Minimum fee under normal conditions — 0.30%. Spec §17.1.
    uint24 internal constant BASE_FEE = 3000;

    /// @notice Absolute fee ceiling — 5.00%. Spec §16.
    ///         Leaves 4.70% of headroom for the five premiums and the
    ///         directional adjustment, and is where §22 clamps a stale market.
    uint24 internal constant MAX_FEE = 50_000;

    // ─── Trade-cap bounds (USDC notional, 6 decimals) ────────────────────

    /// @notice Hard ceiling on any single swap — $10,000. Spec §21.
    uint256 internal constant ABS_MAX_TRADE = 10_000e6;

    /// @notice Floor the dynamic cap may fall to — $100. Spec §21, §22.
    uint256 internal constant MIN_TRADE_CAP = 100e6;

    // ─── Timings (seconds) ───────────────────────────────────────────────

    /// @notice Keeper state older than this is stale. Spec §22.
    uint64 internal constant STALE_AFTER = 900;

    /// @notice How far before kickoff trading halts. Spec §6.
    /// @dev Zero deliberately. `Market.freeze()` becomes callable exactly at
    ///      `startsAt`; a non-zero lead would have the hook stop trading
    ///      before the market contract considers itself frozen, leaving the two
    ///      disagreeing about when the market closed.
    uint64 internal constant FREEZE_LEAD = 0;

    // ─── Pure checks ─────────────────────────────────────────────────────

    /// @notice Clamp a computed fee into `[BASE_FEE, MAX_FEE]`. Spec §16, §18.
    /// @dev The single choke point for spec §44's "fee below BASE_FEE" and
    ///      "fee above MAX_FEE" failure conditions — premium arithmetic is
    ///      allowed to overshoot as long as it passes through here.
    function clampFee(uint24 fee) internal pure returns (uint24) {
        if (fee < BASE_FEE) return BASE_FEE;
        if (fee > MAX_FEE) return MAX_FEE;
        return fee;
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

    /// @notice Whether the kickoff freeze has fired. Spec §6.
    /// @dev Depends only on the registration timestamp and the block clock —
    ///      never on keeper liveness, which is spec §44's "kickoff freeze
    ///      depends on a keeper update" failure condition.
    function isFrozen(uint64 kickoffTimestamp, uint64 nowTs) internal pure returns (bool) {
        uint64 freezeAt = kickoffTimestamp > FREEZE_LEAD ? kickoffTimestamp - FREEZE_LEAD : 0;
        return nowTs >= freezeAt;
    }
}
