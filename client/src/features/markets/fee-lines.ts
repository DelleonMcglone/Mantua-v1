/**
 * T-008 — the ticket's fee review lines and the 0.70% ceiling guard, over
 * the `feeSummary` built from the hook's quote (market-trade-core.ts).
 * Pure: no React, no `@/` imports.
 */
import type { FeeQuoteWire, FeeSummary } from "./market-trade-core.ts";

/** The immutable ceiling (`RiskPolicy.MAX_RATE`, 0.70%), in pips. */
export const MAX_FEE_PIPS = 7000;

/**
 * T-008 — the ticket never displays a fee above the ceiling. The hook
 * cannot return one, so a quote that does is a broken wire, not a price:
 * the ticket refuses it instead of rendering it.
 */
export function feeExceedsCeiling(fee: Pick<FeeQuoteWire, "feePips" | "ratePips">): boolean {
  return fee.feePips > MAX_FEE_PIPS || fee.ratePips > MAX_FEE_PIPS;
}

export interface FeeLine {
  label: string;
  value: string;
}

/**
 * The review block, rendered in every season (0% shows as $0.00 / 0.00%).
 * Buys: Position / Fee / Fee rate / Total. Sells: the fee is taken from the
 * contracts sold, so the block lists the contracts and the fee's dollar
 * value — there is no "total" leaving the wallet.
 */
export function feeLines(summary: FeeSummary, direction: "buy" | "sell"): FeeLine[] {
  if (direction === "sell") {
    return [
      { label: "Contracts sold", value: summary.total },
      { label: "Fee", value: `$${summary.fee}` },
      { label: "Fee rate", value: summary.ratePct },
    ];
  }
  return [
    { label: "Position", value: `$${summary.position}` },
    { label: "Fee", value: `$${summary.fee}` },
    { label: "Fee rate", value: summary.ratePct },
    { label: "Total", value: `$${summary.total}` },
  ];
}
