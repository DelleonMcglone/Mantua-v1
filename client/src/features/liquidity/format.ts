/**
 * Pair-symbol helpers for the liquidity surfaces. The old local
 * `formatUsd` / `formatPct` copies moved to the canonical
 * `@/lib/format.ts` (`compact` / `pct`) in B-015.
 */

/** Best-effort symbol normalization: pool symbols use "WETH-USDC" form. */
export function normalizePairSymbol(s: string): string {
  return s.replace(/^WETH-/, "ETH-").replace(/-WETH$/, "-ETH");
}
