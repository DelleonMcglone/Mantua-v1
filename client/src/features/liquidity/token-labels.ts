import { TOKENS, ZERO_ADDRESS } from "@/lib/tokens.ts";

/**
 * Look up our supported-token symbol from an on-chain address. Falls
 * back to the truncated address when the token isn't in our registry
 * (e.g. someone added a position to a non-supported pair).
 */
export function tokenLabelByAddress(address: string): string {
  const lower = address.toLowerCase();
  if (lower === ZERO_ADDRESS.toLowerCase()) return "ETH";
  for (const t of Object.values(TOKENS)) {
    if (t.native) continue;
    if (t.address.toLowerCase() === lower) return t.symbol;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
