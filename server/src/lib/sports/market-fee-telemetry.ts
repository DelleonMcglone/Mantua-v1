/**
 * D-105 fee telemetry (task 049, H-011): recover the fee a confirmed market
 * trade paid from the `MarketFeeUpdated` log the Dynamic Market Hook emits
 * on every swap, so `market_fills` can record it for analytics and the UI.
 *
 * Pure over receipt logs — the route hands in the logs it already verified,
 * this module never touches the chain.
 */

import { parseEventLogs, type Log } from "viem";
import { DYNAMIC_MARKET_HOOK_ABI } from "../markets-contracts.ts";
import { feeQuoteFromBreakdown, type MarketFeeQuote } from "./market-fee.ts";

/** The columns the fill row stores; every field null when no hook log was found. */
export interface FillFeeTelemetry {
  feePips: number | null;
  feeRatePips: number | null;
  feeProbabilityBps: number | null;
  feeUsdcRaw: string | null;
  playoffs: boolean | null;
}

export const NO_FEE_TELEMETRY: FillFeeTelemetry = {
  feePips: null,
  feeRatePips: null,
  feeProbabilityBps: null,
  feeUsdcRaw: null,
  playoffs: null,
};

/**
 * Decode the hook's fee event for one fill. `hook` is the chain's deployed
 * hook address — logs from any other emitter are ignored, so a forged event
 * from an unrelated contract in the same transaction cannot masquerade as
 * the fee. Returns the quote shape (for callers that want the breakdown)
 * or null when the receipt carried no hook event.
 */
export function feeQuoteFromReceiptLogs(
  logs: readonly Log[],
  hook: `0x${string}`,
  direction: "buy" | "sell",
  tokensRaw: string,
  usdcRaw: string,
): MarketFeeQuote | null {
  const hookLogs = logs.filter((l) => l.address.toLowerCase() === hook.toLowerCase());
  const decoded = parseEventLogs({
    abi: DYNAMIC_MARKET_HOOK_ABI,
    eventName: "MarketFeeUpdated",
    logs: hookLogs,
  });
  const event = decoded.at(0);
  if (!event) return null;
  // The gross input the pip fee applied to: USDC on a buy, YES on a sell.
  const inputIsYes = direction === "sell";
  const amountIn = BigInt(inputIsYes ? tokensRaw : usdcRaw);
  return feeQuoteFromBreakdown(event.args.effectiveFee, event.args.breakdown, amountIn, inputIsYes);
}

/** The fill-row columns for a quote, or the all-null record. */
export function fillFeeTelemetry(quote: MarketFeeQuote | null): FillFeeTelemetry {
  if (!quote) return NO_FEE_TELEMETRY;
  return {
    feePips: quote.feePips,
    feeRatePips: quote.ratePips,
    feeProbabilityBps: quote.probabilityBps,
    feeUsdcRaw: quote.feeUsdcRaw,
    playoffs: quote.playoffs,
  };
}
