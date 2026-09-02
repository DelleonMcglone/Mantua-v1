// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Market} from "./Market.sol";

/// @title MarketPoolBootstrap
/// @notice Opens the YES/USDC Uniswap v4 pool for a market and initialises it
///         at the opening implied probability. B1-009.
///
/// @dev **Where the price comes from.** `sqrtPriceX96` is computed off-chain
///      by `server/src/lib/probability.ts` (B1-010) and passed in. That module
///      is the single owner of the price ↔ probability conversion; duplicating
///      the maths in Solidity would create a second implementation that could
///      drift from it, and the drift would show up as pools opening at subtly
///      wrong odds. On-chain we only need the number, not the derivation.
///
///      **Token ordering matters and is not a choice.** v4 sorts a pool's
///      currencies by address, and its price is always token1-per-token0. The
///      caller must compute `sqrtPriceX96` for the ordering this library
///      reports via `poolKeyFor` — seeding with the ordering reversed opens
///      the market at 1 − p, silently and expensively.
library MarketPoolBootstrap {
    using PoolIdLibrary for PoolKey;

    error SameToken();

    /// @notice Build the canonical pool key for a market's YES/USDC pair.
    /// @param market       The market whose YES token the pool trades.
    /// @param usdc         Collateral token address.
    /// @param fee          LP fee, or `0x800000` for a dynamic-fee pool when
    ///                     the Dynamic Market Hook is attached.
    /// @param tickSpacing  Tick spacing for the pool.
    /// @param hook         Hook address, or `address(0)` for no hook. The
    ///                     Dynamic Market Hook goes here once DM-110 is
    ///                     resolved and B2 deploys it.
    /// @return key         The pool key, currencies sorted per v4.
    /// @return yesIsToken0 Whether YES sorted into the token0 slot — the
    ///                     caller needs this to compute `sqrtPriceX96`
    ///                     the right way round.
    function poolKeyFor(Market market, address usdc, uint24 fee, int24 tickSpacing, address hook)
        internal
        view
        returns (PoolKey memory key, bool yesIsToken0)
    {
        address yes = address(market.yesToken());
        if (yes == usdc) revert SameToken();

        yesIsToken0 = yes < usdc;
        (address token0, address token1) = yesIsToken0 ? (yes, usdc) : (usdc, yes);

        key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hook)
        });
    }

    /// @notice Initialise the pool at the opening implied probability.
    /// @param manager      The v4 PoolManager.
    /// @param key          Key from `poolKeyFor`.
    /// @param sqrtPriceX96 Opening price, from `probabilityToSqrtPriceX96` in
    ///                     `server/src/lib/probability.ts`, computed with the
    ///                     `yesIsToken0` that `poolKeyFor` returned.
    /// @return poolId      The initialised pool's id.
    /// @return tick        The tick the pool opened at.
    function initializePool(IPoolManager manager, PoolKey memory key, uint160 sqrtPriceX96)
        internal
        returns (PoolId poolId, int24 tick)
    {
        tick = manager.initialize(key, sqrtPriceX96);
        poolId = key.toId();
    }
}
