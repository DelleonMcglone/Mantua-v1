// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title MarketErrors
/// @notice PURPOSE: every custom error the Dynamic Market Hook and its registry
///         can revert with, in one place. Spec §30.
///
/// @dev Centralised so a revert means the same thing wherever it is thrown, and
///      so the UI and the deploy scripts have a single list of selectors to
///      decode against. Renaming an error or changing its parameters is a
///      breaking change for those consumers; `MarketErrors.t.sol` asserts the
///      selectors exist and are distinct so that shows up in CI.
///
///      Halt reasons are deliberately separate errors rather than one
///      `Halted(reason)`. A trader who hits a frozen market, a resolved market,
///      and a paused market is in three different situations — the first waits,
///      the second redeems, the third waits for an operator — and the interface
///      can only say which if the revert distinguishes them.
library MarketErrors {
    // ─── Authorisation (spec §28.1, §25) ─────────────────────────────────

    /// @notice A hook callback was invoked by something other than the
    ///         PoolManager. Spec §28.1; §44 failure condition.
    error NotPoolManager();

    /// @notice Caller is not the authorised keeper. Spec §25.
    error NotKeeper();

    /// @notice Caller is not the operator. Spec §25.
    error NotOperator();

    /// @notice Caller is not the pending operator named in a transfer. Spec §26.
    error NotPendingOperator();

    // ─── Registration (spec §8) ──────────────────────────────────────────

    /// @notice No registration exists for this pool. Spec §8; initialization of
    ///         an unregistered pool is a §44 failure condition.
    error PoolNotRegistered();

    /// @notice This pool is already registered. Registration is once-only so a
    ///         kickoff timestamp cannot be rewritten by re-registering (§25).
    error PoolAlreadyRegistered();

    /// @notice The pool key carries a static fee. The hook requires
    ///         `LPFeeLibrary.DYNAMIC_FEE_FLAG`, without which it could not
    ///         override the fee at all. Spec §8; §44 failure condition.
    error StaticFeePoolRejected();

    /// @notice Kickoff is at or before the current block. Such a market would
    ///         be born frozen and never tradeable.
    error KickoffInPast();

    // ─── Halts (spec §23, §24) ───────────────────────────────────────────

    /// @notice The kickoff freeze has fired. Spec §6.
    error MarketFrozen();

    /// @notice The market has resolved; trading is permanently halted. Spec §5.
    error MarketResolved();

    /// @notice The market has been voided; trading is permanently halted. Spec §5.
    error MarketVoided();

    /// @notice An operator has paused the market. Spec §24.
    error MarketPaused();

    // ─── Bounds (spec §12, §20, §28.4) ───────────────────────────────────

    /// @notice The swap's USDC notional exceeds the market's cap. Spec §20.
    /// @param notional The swap's USDC-equivalent notional.
    /// @param cap The cap it breached.
    error TradeExceedsCap(uint256 notional, uint256 cap);

    /// @notice A probability outside `[0, 10_000]` bps. Spec §10, §28.4.
    error ProbabilityOutOfRange(uint256 probabilityBps);

    /// @notice A confidence outside `[0, 10_000]` bps. Spec §12, §28.4.
    error ConfidenceOutOfRange(uint256 confidenceBps);

    /// @notice A zero address where one is not permitted — an immutable
    ///         registry or PoolManager set to zero would brick the hook.
    error ZeroAddress();

    // ─── Reentrancy (spec §28.3) ─────────────────────────────────────────

    /// @notice A mutating path was re-entered. Spec §28.3.
    error Reentrancy();
}
