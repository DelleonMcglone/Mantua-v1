/**
 * Re-banding — keeping thin books inside the economically valid
 * [0, 1] YES-price band.
 *
 * A YES token redeems for at most 1 USDC, so any pool price above 1 (or
 * below 0) is free money for an arbitrageur — but thin books can have no
 * arbitrageurs, so nothing pulls an absurd price back (GS@MIN's YES traded
 * at 3.1 USDC on 2026-08-24; the board clamped the DISPLAY, the pool stayed
 * wrong). The market signer plays the arb instead: split USDC into YES+NO
 * and sell YES into an overpriced pool, or buy YES out of an underpriced
 * one and merge sets back to USDC.
 *
 * This module is the pure half — trigger thresholds, swap direction, price
 * limit, and input sizing — mirroring `planMarketPool`'s split from the
 * transaction layer. `rebandOpenMarkets` (markets-onchain.ts) turns the
 * plan into transactions.
 */

import { probabilityToSqrtPriceX96, sqrtPriceX96ToRawProbability } from "../probability.ts";

/** 2^96, the Q64.96 scaling factor. */
const Q96 = 2n ** 96n;

/** Act only past these, and walk the price back to the matching target.
 *  The trigger/target gap is hysteresis: a book re-banded to 0.99 does not
 *  re-trigger next tick over dust, and fees/rounding near the boundary
 *  cannot make the sweep oscillate. */
export const REBAND_HIGH_TRIGGER = 1.02;
export const REBAND_HIGH_TARGET = 0.99;
export const REBAND_LOW_TRIGGER = 0.01;
export const REBAND_LOW_TARGET = 0.02;

export type RebandAction = "sell-yes" | "buy-yes";

/** What (if anything) to do about a raw YES price. Null inside the band —
 *  and on degenerate inputs, where doing nothing is the safe read. */
export function planReband(rawYesPrice: number): RebandAction | null {
  if (!Number.isFinite(rawYesPrice) || rawYesPrice <= 0) return null;
  if (rawYesPrice > REBAND_HIGH_TRIGGER) return "sell-yes";
  if (rawYesPrice < REBAND_LOW_TRIGGER) return "buy-yes";
  return null;
}

/**
 * Exact input that walks a constant-liquidity pool from `sqrtCurrentX96`
 * to `sqrtTargetX96` (v4 in-range swap math, rounded up):
 *
 *   target below current → token0 in:  Δ0 = L·Q96·(√Pa − √Pb) / (√Pa·√Pb)
 *   target above current → token1 in:  Δ1 = L·(√Pb − √Pa) / Q96
 *
 * Constant L holds exactly for the sweep's own full-range seeds; user
 * positions can bend it, which the caller's headroom plus the swap's hard
 * price limit absorb (overshoot is impossible, undershoot heals next tick).
 */
export function inputToMovePrice(
  liquidity: bigint,
  sqrtCurrentX96: bigint,
  sqrtTargetX96: bigint,
): bigint {
  if (liquidity <= 0n || sqrtCurrentX96 <= 0n || sqrtTargetX96 <= 0n) return 0n;
  if (sqrtTargetX96 < sqrtCurrentX96) {
    const den = sqrtCurrentX96 * sqrtTargetX96;
    return (liquidity * Q96 * (sqrtCurrentX96 - sqrtTargetX96) + den - 1n) / den;
  }
  if (sqrtTargetX96 > sqrtCurrentX96) {
    return (liquidity * (sqrtTargetX96 - sqrtCurrentX96) + Q96 - 1n) / Q96;
  }
  return 0n;
}

export interface RebandSwapPlan {
  action: RebandAction;
  zeroForOne: boolean;
  /** The swap's hard stop at the re-band target — the pool cannot be pushed
   *  past it no matter how much input is offered. */
  sqrtPriceLimitX96: bigint;
  /** True when the exact-input side is the YES token (the sell leg). */
  inputIsYes: boolean;
  /** Exact-input budget (raw 6dp) that reaches the limit at current
   *  liquidity, plus 25% headroom for the swap fee and any extra liquidity
   *  picked up along the way. Overshoot is harmless (the limit stops the
   *  swap; leftovers merge back), so headroom errs generous. */
  maxInput: bigint;
}

/**
 * The full swap plan for one pool's current state, or null when the price
 * sits inside the band (or the pool is uninitialized / unliquid — an empty
 * book has nothing to push against; seeding, not re-banding, fixes it).
 */
export function planRebandSwap(args: {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  yesIsToken0: boolean;
}): RebandSwapPlan | null {
  if (args.sqrtPriceX96 <= 0n || args.liquidity <= 0n) return null;
  const action = planReband(sqrtPriceX96ToRawProbability(args.sqrtPriceX96, args.yesIsToken0));
  if (!action) return null;

  const inputIsYes = action === "sell-yes";
  const target = inputIsYes ? REBAND_HIGH_TARGET : REBAND_LOW_TARGET;
  // Selling YES pushes the YES price down, buying pushes it up; v4's pool
  // ratio is token1-per-token0, so probabilityToSqrtPriceX96 lands the
  // limit on the correct side of the current price in both orderings.
  const sqrtPriceLimitX96 = probabilityToSqrtPriceX96(target, args.yesIsToken0);
  const exact = inputToMovePrice(args.liquidity, args.sqrtPriceX96, sqrtPriceLimitX96);
  if (exact === 0n) return null;
  return {
    action,
    zeroForOne: inputIsYes ? args.yesIsToken0 : !args.yesIsToken0,
    sqrtPriceLimitX96,
    inputIsYes,
    maxInput: (exact * 5n) / 4n + 1n,
  };
}
