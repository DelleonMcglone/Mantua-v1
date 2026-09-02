// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IMarketStateRegistry as I} from "./IMarketStateRegistry.sol";
import {MarketMath} from "./MarketMath.sol";
import {RiskPolicy} from "./RiskPolicy.sol";

/// @title MarketFeeCalculator
/// @notice PURPOSE: turns derived market conditions into a fee and a trade cap.
///         Five-premium stack, directional adjustment, stale handling, clamping.
///         Spec §16-§18, §21, §22.
///
/// @dev **Directional adjustment follows the Nezlobin shape used by the
///      dynamic-fee hook** (spec §18, §31): the side of the trade that adds to
///      existing risk pays a surcharge, the side that relieves it does not. The
///      dynamic-fee library keys off an oracle deviation zone; here the analogue
///      is the pool's own imbalance, since a prediction market has no external
///      reference price to deviate from. The asymmetry is the reused idea — a
///      literal import would bring a `DeviationMonitor.Zone` this market cannot
///      produce.
///
///      Premiums are scaled fractions of the band above `BASE_FEE`, so their
///      sum cannot leave the band by construction; `clampFee` is the belt to
///      that braces (spec §44).
library MarketFeeCalculator {
    /// @notice Everything the fee depends on. All bps except `liquidity`.
    struct Inputs {
        uint256 marketProbBps;
        uint256 modelProbBps;
        uint256 confidenceBps;
        uint256 volatilityBps;
        uint256 imbalanceBps;
        uint128 liquidity;
        I.EventState eventState;
        bool stale;
        bool increasesRisk;
    }

    /// @notice Per-premium contributions, for the §29 event.
    struct Breakdown {
        uint24 baseFee;
        uint24 volatilityPremium;
        uint24 imbalancePremium;
        uint24 liquidityPremium;
        uint24 eventRiskPremium;
        uint24 deviationPremium;
        uint24 directionalAdjustment;
    }

    uint256 private constant BPS = 10_000;

    /// @dev Each premium's share of the headroom between BASE_FEE and MAX_FEE.
    ///      They total 100%, so all six at maximum reach exactly MAX_FEE.
    uint256 private constant W_VOLATILITY = 2500;
    uint256 private constant W_IMBALANCE = 2000;
    uint256 private constant W_LIQUIDITY = 1500;
    uint256 private constant W_EVENT = 2000;
    uint256 private constant W_DEVIATION = 1000;
    uint256 private constant W_DIRECTIONAL = 1000;

    /// @notice Liquidity at or above this is "deep" and adds no premium.
    uint256 private constant DEEP_LIQUIDITY = 100_000e6;

    function _headroom() private pure returns (uint256) {
        return RiskPolicy.MAX_FEE - RiskPolicy.BASE_FEE;
    }

    /// @dev A premium worth `ratioBps` of its `weight` share of the headroom.
    function _premium(uint256 ratioBps, uint256 weight) private pure returns (uint24) {
        if (ratioBps > BPS) ratioBps = BPS;
        return uint24((_headroom() * weight * ratioBps) / (BPS * BPS));
    }

    /// @notice Event-state risk as a bps ratio. Spec §17.5.
    function _eventRatio(I.EventState s) private pure returns (uint256) {
        if (s == I.EventState.PRE_GAME) return 0;
        if (s == I.EventState.LIVE) return 4000;
        if (s == I.EventState.CRITICAL) return BPS;
        // FINAL, RESOLVED, VOID are halted states — the hook reverts before
        // reaching the calculator, but price them at maximum defensively.
        return BPS;
    }

    /// @notice Thin liquidity as a bps ratio. Spec §17.4, §15.
    function _liquidityRatio(uint128 liquidity) private pure returns (uint256) {
        if (liquidity >= DEEP_LIQUIDITY) return 0;
        // Zero liquidity is maximum risk, not a division by zero.
        return BPS - (uint256(liquidity) * BPS) / DEEP_LIQUIDITY;
    }

    /// @notice Model/market disagreement, weighted by confidence. Spec §11, §12.
    function _deviationRatio(Inputs memory i) private pure returns (uint256) {
        uint256 gap =
            i.marketProbBps > i.modelProbBps ? i.marketProbBps - i.modelProbBps : i.modelProbBps - i.marketProbBps;
        // Confidence gates it: an unsure model barely moves the fee (§12).
        return (gap * i.confidenceBps) / BPS;
    }

    /// @notice The five-premium stack plus deviation and direction. Spec §16.
    /// @dev A stale market skips the whole stack and takes `MAX_FEE` (§22) —
    ///      fail closed. It does not revert, so an offline keeper cannot brick
    ///      trading (§44).
    function calculate(Inputs memory i) internal pure returns (uint24 fee, Breakdown memory b) {
        b.baseFee = RiskPolicy.BASE_FEE;
        if (i.stale) return (RiskPolicy.MAX_FEE, b);

        b.volatilityPremium = _premium(i.volatilityBps, W_VOLATILITY);
        b.imbalancePremium = _premium(i.imbalanceBps, W_IMBALANCE);
        b.liquidityPremium = _premium(_liquidityRatio(i.liquidity), W_LIQUIDITY);
        b.eventRiskPremium = _premium(_eventRatio(i.eventState), W_EVENT);
        b.deviationPremium = _premium(_deviationRatio(i), W_DEVIATION);
        // Nezlobin: only the risk-increasing side pays the directional share.
        b.directionalAdjustment = i.increasesRisk ? _premium(i.imbalanceBps, W_DIRECTIONAL) : 0;

        uint256 sum = uint256(b.baseFee) + b.volatilityPremium + b.imbalancePremium + b.liquidityPremium
            + b.eventRiskPremium + b.deviationPremium + b.directionalAdjustment;
        fee = RiskPolicy.clampFee(sum > type(uint24).max ? type(uint24).max : uint24(sum));
    }

    /// @notice Per-swap cap for current conditions. Spec §21.
    /// @dev Shrinks from `ABS_MAX_TRADE` toward `MIN_TRADE_CAP` as risk rises,
    ///      taking the worst of the three risk ratios rather than blending them:
    ///      any one of thin liquidity, wild volatility, or heavy one-sided flow
    ///      is reason enough to cut size.
    function tradeCap(Inputs memory i) internal pure returns (uint256) {
        if (i.stale) return RiskPolicy.MIN_TRADE_CAP;

        uint256 risk = i.volatilityBps;
        if (i.imbalanceBps > risk) risk = i.imbalanceBps;
        uint256 liq = _liquidityRatio(i.liquidity);
        if (liq > risk) risk = liq;
        uint256 ev = _eventRatio(i.eventState);
        if (ev > risk) risk = ev;
        if (risk > BPS) risk = BPS;

        uint256 span = RiskPolicy.ABS_MAX_TRADE - RiskPolicy.MIN_TRADE_CAP;
        return RiskPolicy.clampTradeCap(RiskPolicy.ABS_MAX_TRADE - (span * risk) / BPS);
    }
}
