/**
 * USDC is the only asset a Mantua account shows (owner decision, D-123 and
 * the 2026-10-02 walkthroughs). The token registry still carries the others
 * for pricing and the trade engine; nothing the user or their agent reads
 * as "my balances" does. Mirror of client/src/features/portfolio/display-symbols.ts.
 */
export const DISPLAY_SYMBOLS: readonly string[] = ["USDC"];

export function onlyDisplayed<T extends { symbol: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => DISPLAY_SYMBOLS.includes(r.symbol));
}
