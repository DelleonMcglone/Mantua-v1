/**
 * Phase 9 / PF-001, PF-003, PF-012 — pure helpers behind the portfolio
 * surfaces: the cross-account holdings aggregate, market positions grouped
 * by game with their payout line, and settled-history lines. No React.
 */

export interface MarketPositionRow {
  marketId: string;
  outcomeIndex?: number;
  label: string;
  state: string;
  startsAt?: number;
  side: "yes" | "no";
  balance: string;
  impliedProbBps: number | null;
  valueRaw: string;
  league: string | null;
  providerEventId: string | null;
  entryPriceBps: number | null;
  pnlRaw: string | null;
  potentialPayoutRaw?: string;
}

const usd6 = (raw: string | null | undefined): number => (raw ? Number(raw) / 1e6 : 0);
const fmtUsd = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Falcons to beat Saints" → "Falcons vs Saints" (the game the market belongs to). */
export function gameLabel(marketLabel: string): string {
  const m = /^(.+?) to beat (.+)$/.exec(marketLabel);
  return m ? `${m[1]} vs ${m[2]}` : marketLabel;
}

export interface GameGroup {
  key: string;
  label: string;
  league: string | null;
  rows: MarketPositionRow[];
  /** Σ mark value, USD. */
  valueUsd: number;
  /** Σ potential payout at par, USD. */
  potentialPayoutUsd: number;
}

/** Group positions by game (providerEventId, else marketId), preserving order. */
export function groupPositionsByGame(rows: readonly MarketPositionRow[]): GameGroup[] {
  const groups: GameGroup[] = [];
  const byKey = new Map<string, GameGroup>();
  for (const r of rows) {
    const key = r.providerEventId ?? r.marketId;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        label: gameLabel(r.label),
        league: r.league,
        rows: [],
        valueUsd: 0,
        potentialPayoutUsd: 0,
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.rows.push(r);
    g.valueUsd = Number((g.valueUsd + usd6(r.valueRaw)).toFixed(2));
    g.potentialPayoutUsd = Number(
      (g.potentialPayoutUsd + usd6(r.potentialPayoutRaw ?? r.balance)).toFixed(2),
    );
  }
  return groups;
}

/** The per-position payout line: what this side pays at par if it wins. */
export function payoutLine(row: MarketPositionRow): string {
  const payout = usd6(row.potentialPayoutRaw ?? row.balance);
  return `pays ${fmtUsd(payout)} if ${row.side === "yes" ? "it wins" : "it loses"}`;
}

export interface HoldingsInput {
  userWalletUsd: number | null;
  agentWalletUsd: number | null;
  marketPositionsUsd: number | null;
  /** Task 072 — open combo tickets marked at the combo pool price. */
  comboPositionsUsd: number | null;
}

export interface HoldingsSummary {
  totalUsd: number;
  parts: { key: keyof HoldingsInput; label: string; usd: number }[];
  /** Sources that could not be read (null inputs) — shown as "not counted". */
  missing: string[];
}

const LABELS: Record<keyof HoldingsInput, string> = {
  userWalletUsd: "Wallet",
  agentWalletUsd: "Agent wallet",
  marketPositionsUsd: "Market positions",
  comboPositionsUsd: "Combos",
};

/** PF-001 — everything the user holds across wallets and accounts, with the unreadable named. */
export function aggregateHoldings(input: HoldingsInput): HoldingsSummary {
  const parts: HoldingsSummary["parts"] = [];
  const missing: string[] = [];
  let total = 0;
  for (const key of Object.keys(LABELS) as (keyof HoldingsInput)[]) {
    const v = input[key];
    if (v === null) {
      missing.push(LABELS[key]);
      continue;
    }
    if (v > 0) parts.push({ key, label: LABELS[key], usd: Number(v.toFixed(2)) });
    total += v;
  }
  return { totalUsd: Number(total.toFixed(2)), parts, missing };
}

export function sumUsd(rows: readonly { usdValue: number | string | null | undefined }[]): number {
  let t = 0;
  for (const r of rows) {
    const n = typeof r.usdValue === "string" ? Number(r.usdValue) : (r.usdValue ?? 0);
    if (Number.isFinite(n)) t += n;
  }
  return Number(t.toFixed(2));
}

export function sumMarketValueUsd(rows: readonly MarketPositionRow[]): number {
  return Number(rows.reduce((t, r) => t + usd6(r.valueRaw), 0).toFixed(2));
}

export interface SettledRow {
  marketId: string;
  label: string;
  league: string | null;
  /** resolved_win | resolved_loss | voided (or whatever a newer server sends). */
  status: string;
  costUsd: number;
  proceedsUsd: number;
  payoutUsd: number;
  realizedPnlUsd: number | null;
  resolvedAt: string | null;
  redeemed: boolean;
  attribution?: string[];
}

export function settledOutcome(row: SettledRow): { label: string; tone: "win" | "loss" | "void" } {
  if (row.status === "resolved_win") return { label: "Won", tone: "win" };
  if (row.status === "resolved_loss") return { label: "Lost", tone: "loss" };
  return { label: "Voided", tone: "void" };
}

/** "cost $10.00 · paid $16.00 · +$6.00" */
export function settledLine(row: SettledRow): string {
  const parts = [`cost ${fmtUsd(row.costUsd)}`];
  if (row.proceedsUsd > 0) parts.push(`sold ${fmtUsd(row.proceedsUsd)}`);
  if (row.payoutUsd > 0) parts.push(`paid ${fmtUsd(row.payoutUsd)}`);
  if (row.realizedPnlUsd !== null)
    parts.push(`${row.realizedPnlUsd >= 0 ? "+" : "−"}${fmtUsd(Math.abs(row.realizedPnlUsd))}`);
  return parts.join(" · ");
}
