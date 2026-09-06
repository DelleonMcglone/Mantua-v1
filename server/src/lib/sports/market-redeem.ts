/**
 * C-011 GAP-3 — user redemption of winning/void positions.
 *
 * Pure helpers shared by the redeem routes (`server/src/routes/market-redeem.ts`)
 * and unit-tested in isolation. The state → function mapping mirrors the
 * operator sweep (`reclaimSettledMarkets` in `markets-onchain.ts`): on-chain
 * state 4 (INVALID) redeems via `redeemInvalid`, states 2/3 (RESOLVED/SETTLED)
 * via `redeem`, anything earlier is not redeemable.
 *
 * Payout convention (docs/architecture.md, Polymarket conventions): a winning
 * share pays exactly $1; on an INVALID (voided) market every share of either
 * side pays $0.50, so a full YES+NO set returns the $1 it was minted with.
 */

import { encodeFunctionData } from "viem";
import { MARKET_ABI } from "../markets-contracts.ts";

/** The two no-arg redemption entrypoints on `contracts/src/markets/Market.sol`. */
export type RedeemFunction = "redeem" | "redeemInvalid";

/** Market.State on-chain: 0 OPEN, 1 FROZEN, 2 RESOLVED, 3 SETTLED, 4 INVALID. */
export function redeemFunctionForOnchainState(state: number): RedeemFunction | null {
  if (state === 4) return "redeemInvalid";
  if (state === 2 || state === 3) return "redeem";
  return null;
}

/** Same mapping for the DB's string states (markets.state column). */
export function redeemFunctionForDbState(state: string): RedeemFunction | null {
  if (state === "INVALID") return "redeemInvalid";
  if (state === "RESOLVED" || state === "SETTLED") return "redeem";
  return null;
}

/** Calldata for the chosen no-arg redemption call — just the 4-byte selector. */
export function redeemCalldata(fn: RedeemFunction): `0x${string}` {
  return encodeFunctionData({ abi: MARKET_ABI, functionName: fn });
}

/**
 * Estimated USDC payout in raw 6dp units: $1 per winning share, $0.50 per
 * share on INVALID (the contract computes `(yes + no) / 2` across both sides;
 * per-side halving can under-report by at most 1 raw unit of dust).
 */
export function estimatePayoutRaw(fn: RedeemFunction, balanceRaw: bigint): bigint {
  return fn === "redeemInvalid" ? balanceRaw / 2n : balanceRaw;
}

/**
 * P-006 — the settlement value per token for one recorded position:
 * $1 the winning side, $0 the losing side, $0.50 per share on INVALID
 * (either side of a voided market). Returned as the 5dp decimal string the
 * `market_positions.settlement_price` column stores; null when the market
 * has not finished, or a RESOLVED market's winner is unknown to the
 * resolutions log (never guess — the pass retries next tick).
 *
 * `winningOutcomeIndex` is market vocabulary: 0 = YES pays, 1 = NO pays
 * (the same convention the redeemable listing reads).
 */
export function settlementPriceFor(
  side: "yes" | "no",
  state: string,
  winningOutcomeIndex: number | null,
): string | null {
  const fn = redeemFunctionForDbState(state);
  if (fn === null) return null;
  if (fn === "redeemInvalid") return "0.50000";
  if (winningOutcomeIndex !== 0 && winningOutcomeIndex !== 1) return null;
  const winner = winningOutcomeIndex === 0 ? "yes" : "no";
  return side === winner ? "1.00000" : "0.00000";
}

export interface RedeemableSidesInput {
  /** DB market state: OPEN | FROZEN | RESOLVED | SETTLED | INVALID. */
  state: string;
  /**
   * The market's own winning outcome (0 = YES pays, 1 = NO pays) from the
   * resolutions log, or null when unknown (unresolved, or void).
   */
  winningOutcomeIndex: number | null;
  yesBalanceRaw: bigint;
  noBalanceRaw: bigint;
}

export interface RedeemableSide {
  side: "yes" | "no";
  balanceRaw: bigint;
  /** Estimated USDC payout, raw 6dp units. */
  payoutRaw: bigint;
}

/**
 * Which of a holder's sides are worth claiming, per the redemption rules:
 *  - RESOLVED/SETTLED: only the winning side, and only when it is known —
 *    a resolved market whose winner we cannot verify reports nothing rather
 *    than promising a payout the contract would refuse.
 *  - INVALID: any nonzero side (both pay $0.50/share).
 *  - OPEN/FROZEN: nothing — the market is still live.
 */
export function redeemableSides(input: RedeemableSidesInput): RedeemableSide[] {
  const fn = redeemFunctionForDbState(input.state);
  if (fn === null) return [];

  if (fn === "redeemInvalid") {
    const sides: RedeemableSide[] = [];
    if (input.yesBalanceRaw > 0n) {
      sides.push({
        side: "yes",
        balanceRaw: input.yesBalanceRaw,
        payoutRaw: estimatePayoutRaw(fn, input.yesBalanceRaw),
      });
    }
    if (input.noBalanceRaw > 0n) {
      sides.push({
        side: "no",
        balanceRaw: input.noBalanceRaw,
        payoutRaw: estimatePayoutRaw(fn, input.noBalanceRaw),
      });
    }
    return sides;
  }

  if (input.winningOutcomeIndex !== 0 && input.winningOutcomeIndex !== 1) return [];
  const side = input.winningOutcomeIndex === 0 ? "yes" : "no";
  const balanceRaw = side === "yes" ? input.yesBalanceRaw : input.noBalanceRaw;
  if (balanceRaw === 0n) return [];
  return [{ side, balanceRaw, payoutRaw: estimatePayoutRaw(fn, balanceRaw) }];
}
