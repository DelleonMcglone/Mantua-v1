/**
 * Phase 7 / R-001 — pure parsers for the signed-in stream's user frames
 * (`positions`, `balances`; protocol in server/src/routes/live-stream.ts).
 * A frame that doesn't match is dropped, never half-applied. React- and
 * window-free for node:test.
 */
import type { MarketPositionRow } from "./portfolio-core.ts";

export interface StreamBalance {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  balanceRaw: string;
  usdValue: number;
}

export interface PositionsFrame {
  /** Lowercased — the wallet the server authenticated this stream as. */
  wallet: string;
  positions: MarketPositionRow[];
}

export interface BalancesFrame {
  wallet: string;
  chainId: number;
  balances: StreamBalance[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isWallet(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v);
}

export function parsePositionsFrame(payload: unknown): PositionsFrame | null {
  if (!isObject(payload) || !isWallet(payload["wallet"]) || !Array.isArray(payload["positions"])) {
    return null;
  }
  const rows = payload["positions"] as unknown[];
  const ok = rows.every(
    (r) =>
      isObject(r) &&
      typeof r["marketId"] === "string" &&
      typeof r["balance"] === "string" &&
      (r["side"] === "yes" || r["side"] === "no"),
  );
  return ok ? { wallet: payload["wallet"], positions: rows as MarketPositionRow[] } : null;
}

export function parseBalancesFrame(payload: unknown): BalancesFrame | null {
  if (
    !isObject(payload) ||
    !isWallet(payload["wallet"]) ||
    typeof payload["chainId"] !== "number" ||
    !Array.isArray(payload["balances"])
  ) {
    return null;
  }
  const rows = payload["balances"] as unknown[];
  const ok = rows.every(
    (b) =>
      isObject(b) &&
      typeof b["symbol"] === "string" &&
      typeof b["decimals"] === "number" &&
      typeof b["balanceRaw"] === "string" &&
      /^\d+$/.test(b["balanceRaw"]) &&
      typeof b["usdValue"] === "number",
  );
  return ok
    ? { wallet: payload["wallet"], chainId: payload["chainId"], balances: rows as StreamBalance[] }
    : null;
}

/** Does a frame belong to this address? (The positions hook also serves
 *  the agent's wallet, which the user's stream never carries.) */
export function frameIsFor(frame: { wallet: string }, address: string | null | undefined): boolean {
  return !!address && frame.wallet === address.toLowerCase();
}
