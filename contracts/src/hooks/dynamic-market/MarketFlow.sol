// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IMarketStateRegistry as I} from "./IMarketStateRegistry.sol";
import {MarketErrors} from "./MarketErrors.sol";
import {MarketFeeCalculator as Calc} from "./MarketFeeCalculator.sol";
import {MarketMath} from "./MarketMath.sol";
import {RiskPolicy} from "./RiskPolicy.sol";

/// @title MarketFlow
/// @notice PURPOSE: per-pool flow and volatility accumulators, the halt check,
///         and assembly of the calculator inputs from pool + block state.
///         Spec §4.2, §13, §14, §23.
///
/// @dev Extracted from `DynamicMarketHook` so every file stays inside the §30
///      150-line limit. The split is along a real seam: the hook decides *what
///      to do*, this derives *what is true*.
///
///      **All work here is O(1).** Flow is two running totals decayed on read,
///      not a list of observations — no array to walk, no unbounded loop
///      (spec §14, §28.6), and no storage growing with volume (spec §13).
library MarketFlow {
    using StateLibrary for IPoolManager;

    /// @dev One pool's accumulators.
    struct Data {
        uint128 buy;
        uint128 sell;
        uint64 lastSwap;
        uint32 volatilityBps;
        uint160 lastSqrtPrice;
    }

    /// @dev Weight on each new volatility observation — 20%.
    uint256 private constant VOL_ALPHA_BPS = 2000;

    /// @notice Revert unless the market is currently tradeable. Spec §23.
    /// @dev One place, so the swap and add-liquidity gates cannot drift apart.
    ///      Each reason reverts distinctly because a frozen trader waits, a
    ///      resolved one redeems, and a paused one needs an operator.
    function requireTradeable(I registry, I.MarketState memory s) internal view {
        if (registry.globalPaused() || s.paused) revert MarketErrors.MarketPaused();
        if (s.eventState == I.EventState.RESOLVED) revert MarketErrors.MarketResolved();
        if (s.eventState == I.EventState.VOID) revert MarketErrors.MarketVoided();
        // Timestamp-driven, so it fires with the keeper offline (spec §6, §44).
        if (RiskPolicy.isFrozen(s.kickoffTimestamp, uint64(block.timestamp))) revert MarketErrors.MarketFrozen();
        if (s.eventState == I.EventState.FINAL) revert MarketErrors.MarketFrozen();
    }

    /// @notice Decayed buy/sell flow as of `nowTs`, without writing.
    /// @dev Zero `lastSwap` means no swap yet. Zero elapsed returns the totals
    ///      unchanged, which is what makes two swaps in one block see identical
    ///      flow (spec §33 edge case 11).
    function decayed(Data memory d, uint64 nowTs) internal pure returns (uint256 buy, uint256 sell) {
        uint64 elapsed = d.lastSwap == 0 ? 0 : nowTs - d.lastSwap;
        buy = MarketMath.decayFlow(d.buy, elapsed);
        sell = MarketMath.decayFlow(d.sell, elapsed);
    }

    /// @notice Build the calculator inputs from the pool, the registry, and the
    ///         block. Spec §4.2 — none of this is keeper-writable.
    function conditions(
        Data memory d,
        IPoolManager manager,
        PoolId id,
        I.MarketState memory s,
        SwapParams calldata params
    ) internal view returns (Calc.Inputs memory inputs, uint256 probBps) {
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(id);
        uint128 liquidity = manager.getLiquidity(id);
        probBps = MarketMath.probabilityBps(sqrtPriceX96, s.yesIsToken0);

        (uint256 buy, uint256 sell) = decayed(d, uint64(block.timestamp));
        bool buysYes = params.zeroForOne != s.yesIsToken0;

        inputs = Calc.Inputs({
            marketProbBps: probBps,
            modelProbBps: s.modelProbability,
            confidenceBps: s.confidence,
            volatilityBps: d.volatilityBps,
            imbalanceBps: MarketMath.imbalanceBps(buy, sell, liquidity),
            liquidity: liquidity,
            eventState: s.eventState,
            stale: RiskPolicy.isStale(s.lastUpdate, uint64(block.timestamp)),
            // Risk-increasing means leaning further onto the already-heavy side.
            increasesRisk: buysYes == (buy >= sell)
        });
    }

    /// @notice Fold a completed swap into the accumulators.
    /// @param usdcNotional The swap's size **in USDC**, from
    ///        `MarketMath.usdcNotional`.
    /// @dev The notional is passed in rather than derived from
    ///      `params.amountSpecified`, because that field is denominated in YES
    ///      on some swaps and USDC on others depending on direction and
    ///      exact-in/exact-out. Accumulating it raw would difference two
    ///      different units: a 1000-share sell at 5c would weigh the same as a
    ///      $1000 buy, when the real exposure differs twentyfold. Both sides
    ///      must be in one unit for the §14 imbalance to mean anything.
    ///
    ///      Volatility is the relative price move this swap caused, through an
    ///      EWMA (spec §13). The first swap has no prior price, so it
    ///      contributes a zero observation rather than a spurious 100% move.
    function record(
        Data storage d,
        SwapParams calldata params,
        uint256 usdcNotional,
        uint160 sqrtPriceX96,
        uint64 nowTs
    ) internal {
        (uint256 buy, uint256 sell) = decayed(Data(d.buy, d.sell, d.lastSwap, d.volatilityBps, d.lastSqrtPrice), nowTs);

        uint256 move;
        uint160 prev = d.lastSqrtPrice;
        if (prev != 0 && sqrtPriceX96 != 0) {
            uint256 hi = sqrtPriceX96 > prev ? sqrtPriceX96 : prev;
            uint256 lo = sqrtPriceX96 > prev ? prev : sqrtPriceX96;
            move = ((hi - lo) * MarketMath.BPS) / hi;
        }

        if (params.zeroForOne) buy = _capAdd(buy, usdcNotional);
        else sell = _capAdd(sell, usdcNotional);

        d.buy = uint128(buy);
        d.sell = uint128(sell);
        d.volatilityBps = uint32(MarketMath.ewma(d.volatilityBps, move, VOL_ALPHA_BPS));
        d.lastSwap = nowTs;
        d.lastSqrtPrice = sqrtPriceX96;
    }

    /// @dev Saturating add. A swap large enough to overflow the accumulator is
    ///      already maximally imbalanced, so pinning at the ceiling loses no
    ///      information the fee would use — and reverting here would let one
    ///      huge trade halt an otherwise healthy pool.
    function _capAdd(uint256 a, uint256 b) private pure returns (uint256 c) {
        c = a + b;
        if (c > type(uint128).max) c = type(uint128).max;
    }
}
