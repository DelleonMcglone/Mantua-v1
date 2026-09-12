// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IMarketStateRegistry as I} from "./IMarketStateRegistry.sol";
import {MarketFeeFormula as F} from "./MarketFeeFormula.sol";
import {RiskPolicy} from "./RiskPolicy.sol";

/// @title MarketFeeCalculator
/// @notice PURPOSE: turns derived market conditions into the dynamic rate,
///         the season-gated pip fee, and the trade cap. D-105 (H-003, H-004);
///         spec §16-§18, §21, §22 as superseded by the fee model.
///
/// @dev **Four drivers, one band.** The playoff rate is `MIN_RATE` plus four
///      premiums — liquidity, volatility, trading activity, market
///      uncertainty — each a bounded share of the headroom to `MAX_RATE`.
///      The shares total 100%, so every driver at maximum lands exactly on
///      the ceiling and a calm, deep, agreed, pre-game market pays exactly
///      the floor. `clampRate` is the belt to those braces.
///
///      "Activity" keeps the Nezlobin directional shape (spec §18, §31):
///      the side of the trade that leans onto the already-heavy flow pays a
///      surcharge, the side that relieves it does not. "Uncertainty" is the
///      keeper model's disagreement with the pool, gated by its own stated
///      confidence (§11, §12), plus event-state risk (§17.5).
///
///      **The season gate comes first.** A regular-season pool returns
///      `REGULAR_SEASON_FEE` before any driver is read: no condition, stale
///      or otherwise, can charge a fee outside the playoffs.
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
        bool playoffs;
    }

    /// @notice Per-driver contributions for the `MarketFeeUpdated` event and
    ///         the UI's fee panel. Pips throughout except `probabilityBps`.
    struct Breakdown {
        uint24 minRate;
        uint24 liquidityPremium;
        uint24 volatilityPremium;
        uint24 activityPremium;
        uint24 uncertaintyPremium;
        uint24 rate;
        uint16 probabilityBps;
        bool playoffs;
        bool stale;
    }

    uint256 private constant BPS = 10_000;

    /// @dev Each driver's share of the headroom between MIN_RATE and MAX_RATE.
    uint256 private constant W_LIQUIDITY = 2500;
    uint256 private constant W_VOLATILITY = 2500;
    uint256 private constant W_IMBALANCE = 1500;
    uint256 private constant W_DIRECTIONAL = 1000;
    uint256 private constant W_DEVIATION = 1500;
    uint256 private constant W_EVENT = 1000;

    /// @notice Liquidity at or above this is "deep" and adds no premium.
    uint256 private constant DEEP_LIQUIDITY = 100_000e6;

    /// @dev A premium worth `ratioBps` of its `weight` share of the headroom.
    function _premium(uint256 ratioBps, uint256 weight) private pure returns (uint24) {
        if (ratioBps > BPS) ratioBps = BPS;
        uint256 headroom = RiskPolicy.MAX_RATE - RiskPolicy.MIN_RATE;
        return uint24((headroom * weight * ratioBps) / (BPS * BPS));
    }

    /// @notice Event-state risk as a bps ratio. Spec §17.5.
    function _eventRatio(I.EventState s) private pure returns (uint256) {
        if (s == I.EventState.PRE_GAME) return 0;
        if (s == I.EventState.LIVE) return 4000;
        // CRITICAL, and the halted states the hook never reaches, price at max.
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
        return (gap * i.confidenceBps) / BPS;
    }

    /// @notice The dynamic rate and its decomposition. A stale market skips
    ///         the drivers and takes `MAX_RATE` (§22) — fail closed, without
    ///         reverting, so an offline keeper cannot brick trading (§44).
    function rate(Inputs memory i) internal pure returns (Breakdown memory b) {
        b.probabilityBps = uint16(i.marketProbBps > BPS ? BPS : i.marketProbBps);
        b.playoffs = i.playoffs;
        b.stale = i.stale;
        if (!i.playoffs) return b; // regular season: every field stays zero.
        b.minRate = RiskPolicy.MIN_RATE;
        if (i.stale) {
            b.rate = RiskPolicy.MAX_RATE;
            return b;
        }
        b.liquidityPremium = _premium(_liquidityRatio(i.liquidity), W_LIQUIDITY);
        b.volatilityPremium = _premium(i.volatilityBps, W_VOLATILITY);
        b.activityPremium =
            _premium(i.imbalanceBps, W_IMBALANCE) + (i.increasesRisk ? _premium(i.imbalanceBps, W_DIRECTIONAL) : 0);
        b.uncertaintyPremium = _premium(_deviationRatio(i), W_DEVIATION) + _premium(_eventRatio(i.eventState), W_EVENT);
        uint256 sum =
            uint256(b.minRate) + b.liquidityPremium + b.volatilityPremium + b.activityPremium + b.uncertaintyPremium;
        b.rate = RiskPolicy.clampRate(sum > type(uint24).max ? type(uint24).max : uint24(sum));
    }

    /// @notice The pip fee to return to v4: `rate × (1 − p)`, which realises
    ///         `Fee = C × rate × p × (1 − p)` on the swap (D-105, H-001).
    function calculate(Inputs memory i) internal pure returns (uint24 fee, Breakdown memory b) {
        b = rate(i);
        fee = F.effectiveFeePips(b.rate, b.probabilityBps);
    }

    /// @notice Per-swap cap for current conditions. Spec §21.
    /// @dev Shrinks from `ABS_MAX_TRADE` toward `MIN_TRADE_CAP` as risk rises,
    ///      taking the worst of the risk ratios rather than blending them:
    ///      any one of thin liquidity, wild volatility, or heavy one-sided flow
    ///      is reason enough to cut size. Season-independent — the cap is a
    ///      risk control, not a fee.
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
