// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @title MarketFeeFormula
/// @notice PURPOSE: Mantua's fee formula, `Fee = C × rate × p × (1 − p)`, and
///         its exact realisation as a Uniswap v4 pip fee. D-105 (H-001, H-005).
///
/// @dev **Why the pip fee is `rate × (1 − p)` and not `rate × p × (1 − p)`.**
///      v4 charges the LP fee as a fraction of the swap's *gross input*. Let
///      `C` be the contract-equivalent of that input at the pre-trade price
///      `p`: a YES input of `C` tokens, or a USDC input `X` worth `X / p`
///      contracts. The formula wants `C · r · p · (1 − p)` USDC:
///
///        USDC in:  feePips · X = r(1−p) · X = (X/p) · r · p · (1−p)   ✓
///        YES in:   feePips · C YES tokens, each worth p, = C · r · p · (1−p) ✓
///
///      The same holds for exact-output swaps, because v4 still takes the fee
///      as a fraction of the gross input. So the *per-contract* fee
///      `r · p · (1 − p)` peaks at p = 0.50 exactly as the spec requires,
///      while the *pip rate on the input* is that per-contract fee divided
///      by the contract's value `p`.
///
///      Every function is pure and total: no reverts for any input. Division
///      floors, so the hook can under-charge by at most one pip and never
///      over-charge — the ceiling is safe from rounding.
library MarketFeeFormula {
    /// @notice Probability unit — 10_000 == 100%.
    uint256 internal constant BPS = 10_000;
    /// @notice v4 fee unit — 1_000_000 == 100%.
    uint256 internal constant PIPS = 1_000_000;

    /// @notice The v4 pip fee that realises the formula: `rate × (1 − p)`.
    /// @param ratePips Dynamic rate in pips (0 in the regular season).
    /// @param probBps  Pre-trade YES probability in bps; values above BPS are
    ///                 treated as certainty and yield 0.
    /// @dev Floors. Bounded by `ratePips` at p = 0, so the fee can never
    ///      exceed the rate ceiling whatever `p` is.
    function effectiveFeePips(uint24 ratePips, uint256 probBps) internal pure returns (uint24) {
        if (probBps >= BPS) return 0;
        return uint24((uint256(ratePips) * (BPS - probBps)) / BPS);
    }

    /// @notice `C × rate × p × (1 − p)`, in the contract's raw units.
    /// @param contracts Number of contracts (raw token units, 6 dp today).
    /// @dev The 512-bit intermediate keeps `type(uint256).max` contracts from
    ///      overflowing; the result is always below `contracts` because
    ///      `rate · p · (1 − p) < 1`. Symmetric under `p ↔ 1 − p` and maximal
    ///      at p = 5000 by construction of `p · (BPS − p)`.
    function contractFee(uint256 contracts, uint24 ratePips, uint256 probBps) internal pure returns (uint256) {
        if (probBps > BPS) probBps = BPS;
        uint256 shape = probBps * (BPS - probBps);
        return FullMath.mulDiv(contracts, uint256(ratePips) * shape, PIPS * BPS * BPS);
    }

    /// @notice The fee v4 takes from a gross input at `feePips`, rounded up
    ///         the way `SwapMath` rounds.
    /// @dev This is the number a pre-trade quote shows the user. It matches
    ///      the executed fee to the raw unit for a single-step swap; a swap
    ///      that crosses ticks rounds once per step, so the executed fee can
    ///      exceed this by one raw unit per step.
    function feeOnInput(uint256 amountIn, uint24 feePips) internal pure returns (uint256) {
        if (amountIn == 0 || feePips == 0) return 0;
        return FullMath.mulDivRoundingUp(amountIn, feePips, PIPS);
    }
}
