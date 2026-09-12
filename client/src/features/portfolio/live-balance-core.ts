/**
 * T-007 — pure helpers for the shared live-balance store. The USDC balance
 * is the number the ticket, the profile, and the funding step all read,
 * so one selector defines it. Kept React-free for node:test.
 */

export interface BalanceRow {
  symbol: string;
  balanceRaw: string;
  decimals: number;
}

/** The raw 6dp USDC balance, or null when the wallet holds none / unknown. */
export function selectUsdcRaw(balances: readonly BalanceRow[] | null): string | null {
  if (!balances) return null;
  const row = balances.find((b) => b.symbol === "USDC");
  if (!row || row.decimals !== 6 || !/^\d+$/.test(row.balanceRaw)) return null;
  return row.balanceRaw;
}

/** Raw 6dp → "$1,234.56" for the balance line. */
export function usdcRawToDollars(raw: string | null): string {
  if (raw === null) return "—";
  const n = Number(raw) / 1e6;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
