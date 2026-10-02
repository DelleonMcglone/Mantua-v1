/**
 * USDC is the only asset a Mantua account shows. The balance feed still
 * returns every registry token (zero rows included) because pricing and the
 * trade engine use the registry; the product surface does not.
 */
export const DISPLAY_SYMBOLS: readonly string[] = ["USDC"];

export function onlyDisplayed<T extends { symbol: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => DISPLAY_SYMBOLS.includes(r.symbol));
}
