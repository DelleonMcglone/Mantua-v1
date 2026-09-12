/**
 * D-105 fee model — the TypeScript mirror of `MarketFeeFormula.sol` and the
 * pre-trade quote (task 049, H-012).
 *
 * `Fee = C × rate × p × (1 − p)`. Uniswap v4 charges the LP fee as a
 * fraction of the swap's gross input, so the hook returns `rate × (1 − p)`
 * pips; with `C` the contract-equivalent of that input at the pre-trade
 * price the equality is exact (derivation in `MarketFeeFormula.sol`).
 *
 * Nothing here is a second source of truth: the pip fee the UI shows comes
 * from `DynamicMarketHook.quoteFee`, which runs the same code path as
 * `beforeSwap`. The pure functions below reproduce the Solidity integer
 * maths bit for bit (asserted against the shared vector file in
 * `contracts/test/hooks/dynamic-market/fee-vectors.json`) so amounts can be
 * derived off-chain without ever re-deriving the rate.
 */

import { DYNAMIC_MARKET_HOOK_ABI } from "../markets-contracts.ts";
import type { getRpcClient } from "../rpc-client.ts";
import type { MarketPoolKey } from "./market-pool.ts";

/** v4 fee unit: 1_000_000 == 100%. */
export const FEE_PIPS = 1_000_000n;
/** Probability unit: 10_000 == 100%. */
export const PROB_BPS = 10_000n;

/** `RiskPolicy` bounds — mirrored, never authoritative. */
export const REGULAR_SEASON_FEE_PIPS = 0;
export const MIN_RATE_PIPS = 1_000;
export const MAX_RATE_PIPS = 7_000;

/** `MarketFeeFormula.effectiveFeePips`: `rate × (1 − p)`, floored. */
export function effectiveFeePips(ratePips: number, probabilityBps: number): number {
  if (probabilityBps >= Number(PROB_BPS)) return 0;
  return Number((BigInt(ratePips) * (PROB_BPS - BigInt(probabilityBps))) / PROB_BPS);
}

/** `MarketFeeFormula.contractFee`: `C × rate × p × (1 − p)` in raw units, floored. */
export function contractFee(contracts: bigint, ratePips: number, probabilityBps: number): bigint {
  const p = BigInt(Math.min(probabilityBps, Number(PROB_BPS)));
  const shape = p * (PROB_BPS - p);
  return (contracts * BigInt(ratePips) * shape) / (FEE_PIPS * PROB_BPS * PROB_BPS);
}

/** `MarketFeeFormula.feeOnInput`: what v4 takes from a gross input, rounded up. */
export function feeOnInput(amountIn: bigint, feePips: number): bigint {
  if (amountIn === 0n || feePips === 0) return 0n;
  const product = amountIn * BigInt(feePips);
  return (product + FEE_PIPS - 1n) / FEE_PIPS;
}

/**
 * The fee valued in USDC raw units: a USDC-denominated fee is itself; a
 * YES-denominated fee (sells) is worth `p` per token, floored.
 */
export function feeUsdcValue(feeRaw: bigint, inputIsYes: boolean, probabilityBps: number): bigint {
  if (!inputIsYes) return feeRaw;
  return (feeRaw * BigInt(Math.min(probabilityBps, Number(PROB_BPS)))) / PROB_BPS;
}

/** The hook's `Breakdown` struct, as viem decodes it. */
export interface FeeBreakdown {
  minRate: number;
  liquidityPremium: number;
  volatilityPremium: number;
  activityPremium: number;
  uncertaintyPremium: number;
  rate: number;
  probabilityBps: number;
  playoffs: boolean;
  stale: boolean;
}

/** What a trade will pay, in the wire shape the UI renders. */
export interface MarketFeeQuote {
  /** Pip fee on the gross input — `rate × (1 − p)`, straight from the hook. */
  feePips: number;
  /** The dynamic rate (0 in the regular season, else 1000–7000). */
  ratePips: number;
  probabilityBps: number;
  playoffs: boolean;
  stale: boolean;
  /** Fee in raw units of the input token (USDC for buys, YES for sells). */
  feeRaw: string;
  /** The same fee valued in USDC raw units (6dp). */
  feeUsdcRaw: string;
  breakdown: FeeBreakdown;
}

/** Pure assembly from a decoded breakdown — shared by the quote and the fill telemetry. */
export function feeQuoteFromBreakdown(
  feePips: number,
  breakdown: FeeBreakdown,
  amountIn: bigint,
  inputIsYes: boolean,
): MarketFeeQuote {
  const feeRaw = feeOnInput(amountIn, feePips);
  return {
    feePips,
    ratePips: breakdown.rate,
    probabilityBps: breakdown.probabilityBps,
    playoffs: breakdown.playoffs,
    stale: breakdown.stale,
    feeRaw: feeRaw.toString(),
    feeUsdcRaw: feeUsdcValue(feeRaw, inputIsYes, breakdown.probabilityBps).toString(),
    breakdown,
  };
}

/**
 * Ask the hook what `beforeSwap` would charge for this exact-input swap right
 * now. Reverts exactly where the swap would (halted market, size cap), so a
 * quote that succeeds is a trade the hook will price identically.
 */
export async function quoteMarketFee(
  client: ReturnType<typeof getRpcClient>,
  hook: `0x${string}`,
  key: MarketPoolKey,
  zeroForOne: boolean,
  amountIn: bigint,
  inputIsYes: boolean,
): Promise<MarketFeeQuote> {
  const [feePips, breakdown] = await client.readContract({
    address: hook,
    abi: DYNAMIC_MARKET_HOOK_ABI,
    functionName: "quoteFee",
    args: [key, { zeroForOne, amountSpecified: -amountIn, sqrtPriceLimitX96: 0n }],
  });
  return feeQuoteFromBreakdown(feePips, breakdown, amountIn, inputIsYes);
}
