/**
 * B1-009 — opening each market's YES/USDC pool at the implied probability.
 *
 * Pure key/price construction, separated from the transaction layer for the
 * usual reason. Two footguns live here, both documented on the Solidity
 * side (`MarketPoolBootstrap.sol`) and mirrored exactly:
 *
 *  - v4 sorts a pool's currencies by address and prices token1-per-token0.
 *    Seeding with the ordering reversed opens the market at 1/p instead of
 *    p — silently and expensively. `probabilityToSqrtPriceX96` (B1-010) is
 *    the single owner of that conversion; this module only tells it the
 *    truth about the ordering.
 *  - The pool's fee field must be the DYNAMIC_FEE_FLAG sentinel, not a
 *    static tier, or the PoolManager rejects the Dynamic Market Hook.
 */

import { encodeAbiParameters, keccak256 } from "viem";
import { probabilityToSqrtPriceX96 } from "../probability.ts";
import { DYNAMIC_FEE_FLAG } from "../v4-contracts.ts";

export const MARKET_POOL_TICK_SPACING = 60;

export interface MarketPoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

export interface MarketPoolPlan {
  key: MarketPoolKey;
  poolId: `0x${string}`;
  yesIsToken0: boolean;
  sqrtPriceX96: bigint;
}

/** v4 PoolId = keccak256(abi.encode(poolKey)). */
export function poolIdOf(key: MarketPoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { type: "address", name: "currency0" },
            { type: "address", name: "currency1" },
            { type: "uint24", name: "fee" },
            { type: "int24", name: "tickSpacing" },
            { type: "address", name: "hooks" },
          ],
        },
      ],
      [key],
    ),
  );
}

/**
 * The pool key, id, and opening price for one market's YES/USDC pool.
 * `openingProbability` is 0–1 from the planner (provider odds, or its 0.5
 * fallback when the provider publishes none).
 */
export function planMarketPool(
  yesToken: `0x${string}`,
  usdc: `0x${string}`,
  hook: `0x${string}`,
  openingProbability: number,
): MarketPoolPlan {
  const yesIsToken0 = yesToken.toLowerCase() < usdc.toLowerCase();
  const key: MarketPoolKey = {
    currency0: yesIsToken0 ? yesToken : usdc,
    currency1: yesIsToken0 ? usdc : yesToken,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: MARKET_POOL_TICK_SPACING,
    hooks: hook,
  };
  return {
    key,
    poolId: poolIdOf(key),
    yesIsToken0,
    sqrtPriceX96: probabilityToSqrtPriceX96(openingProbability, yesIsToken0),
  };
}
