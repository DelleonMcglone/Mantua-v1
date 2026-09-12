/**
 * Pure helpers for the outcome-token trade flow (B7-003). Kept free of
 * React/wallet imports so they unit-test under node:test like
 * `market-redeem-core.ts`.
 */

/**
 * Raw 6dp token balance → exact human-units amount string ("1.234567").
 *
 * Built from the digits, not via `Number(raw) / 1e6`: float division can
 * round UP at the last decimal, and a full-balance sell built from a
 * rounded-up amount asks the wallet for more tokens than it holds. The
 * one-click Close flow pre-fills the sidebar with this exact string so
 * "sell everything" means everything, not everything ± 1 microtoken.
 */
export function rawToHuman6(raw: bigint | string): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  if (value < 0n) throw new Error("rawToHuman6: negative balance");
  const s = value.toString().padStart(7, "0");
  const whole = s.slice(0, -6);
  const frac = s.slice(-6).replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

/**
 * D-103 in-play trading: the statuses during which the trade UI stays
 * open. Buying and selling run before AND during the game; the window
 * closes when the event goes final (or is called off) — NOT at kickoff.
 * Every surface that offers a trade control gates on this one predicate
 * so the client cannot disagree with itself about the betting window.
 */
export function isTradableStatus(status: string): boolean {
  return status === "scheduled" || status === "in_progress";
}

/** The `mantua:close-position` event payload — profile rows, the market
 *  detail's positions tab, and the portfolio card all dispatch this to
 *  deep-link the league page's sidebar onto a pre-filled full-balance
 *  sell. `balance` is the raw 6dp holding. */
export interface ClosePositionDetail {
  league: string;
  eventId: string;
  balance: string;
}

/** Build the Close deep-link payload for one open YES position, or null
 *  when the row can't be closed from here (no league/event linkage —
 *  e.g. a market the slate no longer carries). */
export function closePositionDetail(row: {
  side: string;
  state: string;
  league: string | null;
  providerEventId: string | null;
  balance: string;
}): ClosePositionDetail | null {
  if (row.side !== "yes" || row.state !== "OPEN") return null;
  if (!row.league || !row.providerEventId) return null;
  return { league: row.league, eventId: row.providerEventId, balance: row.balance };
}

// ─── D-105 fee line (task 049, T-008 / H-012) ───────────────────────────────

/** The `fee` block on the server's trade quote — straight from the hook. */
export interface FeeQuoteWire {
  feePips: number;
  ratePips: number;
  probabilityBps: number;
  playoffs: boolean;
  /** Fee in raw units of the input token. */
  feeRaw: string;
  /** The same fee valued in USDC raw units (6dp). */
  feeUsdcRaw: string;
}

export interface FeeSummary {
  /** USDC that actually buys contracts: the input net of the fee (buys). */
  position: string;
  /** The fee, in dollars, rounded UP to the cent — never under-quoted. */
  fee: string;
  /** What leaves the wallet: the full input (buys). */
  total: string;
  /** Effective rate on the input, e.g. "0.35%". */
  ratePct: string;
  playoffs: boolean;
}

/** Raw 6dp → "12.34", rounding to the nearest cent. */
function usdc2(raw: bigint): string {
  const cents = (raw + 5_000n) / 10_000n;
  return `${(cents / 100n).toString()}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** Raw 6dp → "0.18", rounding UP to the cent (a non-zero fee never shows as $0.00). */
export function usdcCeil2(raw: bigint): string {
  const cents = (raw + 9_999n) / 10_000n;
  return `${(cents / 100n).toString()}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/**
 * Position / Estimated fee / Total for a buy ticket. Uniswap v4 takes the
 * fee out of the input, so Total is the USDC the wallet sends, Position is
 * what remains to buy contracts, and the two differ by exactly the fee.
 * Uses the hook's own quote (`fee.feeUsdcRaw`) — no fee maths is re-derived
 * here, so the ticket cannot disagree with the execution.
 */
export function feeSummary(amountInRaw: bigint | string, fee: FeeQuoteWire): FeeSummary {
  const amountIn = BigInt(amountInRaw);
  const feeUsdc = BigInt(fee.feeUsdcRaw);
  const position = amountIn > feeUsdc ? amountIn - feeUsdc : 0n;
  return {
    position: usdc2(position),
    fee: usdcCeil2(feeUsdc),
    total: usdc2(amountIn),
    ratePct: `${(fee.feePips / 10_000).toFixed(fee.feePips % 100 === 0 ? 2 : 3)}%`,
    playoffs: fee.playoffs,
  };
}
