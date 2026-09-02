/** Compact USD formatter — $1.2M / $824K / $14.32 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

/** Compact APY/percent formatter — 12.34% */
export function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

/** Best-effort symbol normalization: pool symbols use "WETH-USDC" form. */
export function normalizePairSymbol(s: string): string {
  return s.replace(/^WETH-/, "ETH-").replace(/-WETH$/, "-ETH");
}
