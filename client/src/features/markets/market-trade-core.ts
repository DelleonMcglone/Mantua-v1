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
