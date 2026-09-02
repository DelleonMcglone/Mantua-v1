// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @title MarketMath
/// @notice PURPOSE: derives everything the fee depends on from the pool and the
///         block — probability, USDC notional, EWMA volatility, flow decay,
///         imbalance. Spec §10, §13, §14, §20.
///
/// @dev These are the §4.2 derived values. The keeper cannot write any of them,
///      which is what stops it fabricating market conditions (spec §2.1).
///
///      **Units.** Everything here is basis points — 10_000 == 100%. Fees are v4
///      pips (1_000_000 == 100%) and live in `RiskPolicy`. The two never mix in
///      one expression.
///
///      Every function is pure and total: no reverts, no unbounded loops. A
///      swap must never fail because a risk input was degenerate (spec §15),
///      so zero price, zero liquidity, and zero flow all return a defined
///      answer rather than dividing by zero.
library MarketMath {
    uint256 internal constant BPS = 10_000;
    uint256 private constant Q96 = 2 ** 96;

    /// @notice Flow decays to half its size after this long. Spec §14.
    uint64 internal constant FLOW_HALF_LIFE = 300;

    /// @notice Flow older than this is dropped entirely. Spec §14.
    /// @dev Rational decay approaches zero without reaching it, so without a
    ///      cutoff a swap from hours ago would still contribute a residual to
    ///      the fee forever — exactly the "old activity permanently affecting
    ///      fees" that §14 rules out. Twenty half-lives is already <0.5% of the
    ///      original, so truncating there costs nothing and makes the decay
    ///      terminate.
    uint64 internal constant FLOW_MAX_AGE = 20 * FLOW_HALF_LIFE;

    /// @notice Market-implied probability of YES, in bps. Spec §10.
    /// @param sqrtPriceX96 Current pool price.
    /// @param yesIsToken0 Recorded at registration — never re-derived here.
    /// @dev v4 prices token1 per token0. With YES as token0 the price *is* the
    ///      probability; with YES as token1 it is the reciprocal. Passing the
    ///      flag inverted does not mirror the answer — it inverts the price, so a
    ///      25% market reads as a clamped 100%. Silent and dangerous, which is
    ///      why the registry records the ordering once at registration rather
    ///      than letting callers supply it per call.
    function probabilityBps(uint160 sqrtPriceX96, bool yesIsToken0) internal pure returns (uint256) {
        if (sqrtPriceX96 == 0) return 0;
        // price * 2^96, via 512-bit intermediate: sqrtPriceX96^2 overflows.
        uint256 priceX96 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, Q96);
        if (priceX96 == 0) return yesIsToken0 ? 0 : BPS;

        uint256 bps = yesIsToken0 ? FullMath.mulDiv(priceX96, BPS, Q96) : FullMath.mulDiv(BPS, Q96, priceX96);
        return bps > BPS ? BPS : bps;
    }

    /// @notice USDC-equivalent notional of a swap, for the §20 size cap.
    /// @param amountSpecified v4 swap amount; negative is exact-input.
    /// @param zeroForOne Swap direction.
    /// @param yesIsToken0 Pool ordering, from the registry.
    /// @param probBps Current market probability.
    /// @param outcomeDecimals Outcome-token decimals (spec §9).
    /// @dev The specified amount is denominated in the input token on an
    ///      exact-input swap and the output token on an exact-output one. When
    ///      that token is USDC the notional is the amount; when it is YES the
    ///      amount is worth `p` USDC each, so risk scales with probability — a
    ///      1000-share trade at 5c is $50 of exposure, not $1000.
    function usdcNotional(
        int256 amountSpecified,
        bool zeroForOne,
        bool yesIsToken0,
        uint256 probBps,
        uint8 outcomeDecimals
    ) internal pure returns (uint256) {
        uint256 amount = amountSpecified < 0 ? uint256(-amountSpecified) : uint256(amountSpecified);
        if (amount == 0) return 0;

        // Exact-input names the input token; exact-output names the output.
        bool specifiedIsToken0 = amountSpecified < 0 ? zeroForOne : !zeroForOne;
        bool specifiedIsYes = specifiedIsToken0 == yesIsToken0;
        if (!specifiedIsYes) return amount;

        if (outcomeDecimals > 6) amount /= 10 ** (outcomeDecimals - 6);
        else if (outcomeDecimals < 6) amount *= 10 ** (6 - outcomeDecimals);

        return FullMath.mulDiv(amount, probBps, BPS);
    }

    /// @notice One EWMA step. Spec §13.
    /// @param alphaBps Weight on the new observation.
    /// @dev Bounded by construction: a convex combination of two values in
    ///      `[0, BPS]` cannot leave that range, so volatility needs no clamp
    ///      and cannot grow without limit. No history is stored, so there is no
    ///      unbounded storage growth either.
    function ewma(uint256 prev, uint256 observation, uint256 alphaBps) internal pure returns (uint256) {
        if (alphaBps > BPS) alphaBps = BPS;
        uint256 p = prev > BPS ? BPS : prev;
        uint256 o = observation > BPS ? BPS : observation;
        return (p * (BPS - alphaBps) + o * alphaBps) / BPS;
    }

    /// @notice Decay accumulated flow by elapsed time. Spec §14.
    /// @dev Rational decay — `flow * H / (H + elapsed)` — chosen over an
    ///      exponential because it needs no loop and no exp approximation, both
    ///      of which §14 and §28.6 forbid. It is monotonically decreasing,
    ///      halves at exactly one half-life, and tends to zero, which is all the
    ///      spec requires of it. Zero elapsed returns the input unchanged, so
    ///      two swaps in the same block see the same flow (edge case 11).
    function decayFlow(uint256 flow, uint64 elapsed) internal pure returns (uint256) {
        if (flow == 0 || elapsed == 0) return flow;
        if (elapsed >= FLOW_MAX_AGE) return 0;
        return FullMath.mulDiv(flow, FLOW_HALF_LIFE, uint256(FLOW_HALF_LIFE) + elapsed);
    }

    /// @notice Directional imbalance in bps. Spec §14.
    /// @dev Net one-sided flow measured against liquidity. Zero liquidity with
    ///      any flow is maximum imbalance rather than a division by zero, which
    ///      is how §15's "move toward the risk maximum" is reached; zero flow
    ///      into zero liquidity is an idle pool, so zero.
    function imbalanceBps(uint256 buyFlow, uint256 sellFlow, uint256 liquidity) internal pure returns (uint256) {
        uint256 net = buyFlow > sellFlow ? buyFlow - sellFlow : sellFlow - buyFlow;
        if (net == 0) return 0;
        if (liquidity == 0) return BPS;

        uint256 bps = FullMath.mulDiv(net, BPS, liquidity);
        return bps > BPS ? BPS : bps;
    }
}
