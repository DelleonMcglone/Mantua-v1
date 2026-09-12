import type { PublicEvent, PublicSlate } from "../sports/public-slate.ts";
import type { MarketPositionRow } from "../sports/market-positions.ts";

/**
 * Phase 8 / A-020, A-023, A-024 — the pure halves of the agent's composed
 * read tools. `mantua_search_markets` filters the canonical slates the
 * user's board already reads; `mantua_get_position` / `mantua_get_portfolio`
 * summarise the same marked positions the user's portfolio shows. Nothing
 * here touches a wallet or a chain; the production callers in
 * `agent-chat.ts` feed these from `readCanonicalPublicSlate` + `withLiveOdds`
 * and `readMarketPositions`.
 */

export type MarketStatusFilter = "live" | "upcoming" | "final" | "any";

export interface SearchMarketsInput {
  /** Team name or key fragment; case-insensitive substring. */
  query?: string;
  league?: string;
  status?: MarketStatusFilter;
  limit?: number;
}

export interface MarketSearchRow {
  providerEventId: string;
  league: string;
  matchup: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  /** "live" | "upcoming" | "final", or the raw provider status otherwise. */
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  /** Implied probability of the home side, in bps (null when unpriced). */
  homeWinProbabilityBps: number | null;
  awayWinProbabilityBps: number | null;
  /** True when the probability is the on-chain pool price. */
  liveOdds: boolean;
  /** What to pass to mantua_simulate_trade. */
  outcomes: { outcomeIndex: 0 | 1; label: string }[];
  delayed: boolean;
  dataAsOf: string | null;
}

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 40;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function statusOf(e: PublicEvent, nowMs: number): string {
  if (e.status === "in_progress" || e.status === "live") return "live";
  if (e.status === "final") return "final";
  if (e.status === "scheduled") return e.startsAt * 1000 >= nowMs ? "upcoming" : "scheduled";
  return e.status;
}

function matches(e: PublicEvent, query: string): boolean {
  const q = normalize(query);
  if (q.length === 0) return true;
  const hay = [
    e.home.name,
    e.away.name,
    e.home.key,
    e.away.key,
    e.home.abbreviation,
    e.away.abbreviation,
  ]
    .map(normalize)
    .filter((h) => h.length > 0);
  // "falcons" matches "Atlanta Falcons"; "atlanta falcons game" matches too
  // (a hay of 4+ chars contained in the query), but a 2-letter key never
  // matches a long query by accident.
  return hay.some((h) => h.includes(q) || (h.length > 3 && q.includes(h)));
}

/** Pure: filter + rank slates into the rows the agent relays. */
export function searchMarkets(
  slates: readonly PublicSlate[],
  input: SearchMarketsInput,
  nowMs: number,
): { rows: MarketSearchRow[]; total: number; note: string | null } {
  const wanted = input.status ?? "any";
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(input.limit ?? DEFAULT_LIMIT)));
  const rows: MarketSearchRow[] = [];
  for (const slate of slates) {
    if (input.league !== undefined && normalize(input.league) !== normalize(slate.league)) continue;
    for (const e of slate.events) {
      const status = statusOf(e, nowMs);
      if (wanted !== "any" && status !== wanted) continue;
      if (input.query !== undefined && !matches(e, input.query)) continue;
      const home = e.homeWinProbabilityBps ?? null;
      rows.push({
        providerEventId: e.providerEventId,
        league: slate.league,
        matchup: `${e.away.name} @ ${e.home.name}`,
        homeTeam: e.home.name,
        awayTeam: e.away.name,
        startsAt: new Date(e.startsAt * 1000).toISOString(),
        status,
        homeScore: e.homeScore ?? null,
        awayScore: e.awayScore ?? null,
        homeWinProbabilityBps: home,
        awayWinProbabilityBps: home === null ? null : 10_000 - home,
        liveOdds: e.liveOdds === true,
        outcomes: [
          { outcomeIndex: 0, label: `${e.home.name} to win (YES)` },
          { outcomeIndex: 1, label: `${e.away.name} to win (YES)` },
        ],
        delayed: slate.delayed,
        dataAsOf: slate.dataAsOf === undefined ? null : new Date(slate.dataAsOf).toISOString(),
      });
    }
  }
  const rank = (s: string): number => (s === "live" ? 0 : s === "upcoming" ? 1 : 2);
  rows.sort((a, b) => {
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    // Live and upcoming: soonest first. Final: most recent first.
    return a.status === "final"
      ? b.startsAt.localeCompare(a.startsAt)
      : a.startsAt.localeCompare(b.startsAt);
  });
  const total = rows.length;
  let note: string | null = null;
  if (total === 0) {
    note =
      input.query === undefined
        ? "No games match the filter in the canonical slate."
        : `No game matches "${input.query}" — the slate covers ${slates.map((s) => s.league).join(", ")}; check the team name or drop the filter.`;
  } else if (rows.some((r) => r.delayed)) {
    note = "Some rows come from a delayed slate copy — say how old (dataAsOf) when you cite them.";
  }
  return { rows: rows.slice(0, limit), total, note };
}

export interface PositionSummaryRow {
  marketId: string;
  providerEventId: string | null;
  league: string | null;
  label: string;
  side: "yes" | "no";
  state: string;
  startsAt: string;
  /** Outcome tokens held, 6dp. */
  tokens: number;
  /** Current mark of this side, bps (null when the pool is unpriced). */
  impliedProbBps: number | null;
  /** Mark value in USDC (null when unpriced). */
  valueUsd: number | null;
  entryPriceBps: number | null;
  /** Unrealized P&L in USDC (YES side with indexed fills only). */
  pnlUsd: number | null;
  /** What to pass to mantua_simulate_trade to exit. */
  exit: { direction: "sell"; providerEventId: string; outcomeIndex: 0 | 1; amount: string } | null;
}

export interface PositionsSummary {
  positions: PositionSummaryRow[];
  totals: { count: number; valueUsd: number; pnlUsd: number; unpriced: number };
}

function usd(raw: string): number {
  return Number((Number(raw) / 1e6).toFixed(6));
}

/** Pure: shape the marked positions for the model, with totals and exit hints. */
export function summarizeMarketPositions(
  rows: readonly MarketPositionRow[],
  filter: { providerEventId?: string; marketId?: string } = {},
): PositionsSummary {
  const selected = rows.filter(
    (r) =>
      (filter.providerEventId === undefined || r.providerEventId === filter.providerEventId) &&
      (filter.marketId === undefined || r.marketId.toLowerCase() === filter.marketId.toLowerCase()),
  );
  let valueUsd = 0;
  let pnlUsd = 0;
  let unpriced = 0;
  const positions = selected.map((r): PositionSummaryRow => {
    const priced = r.impliedProbBps !== null;
    if (!priced) unpriced += 1;
    const value = priced ? usd(r.valueRaw) : null;
    const pnl = r.pnlRaw === null ? null : usd(r.pnlRaw);
    valueUsd += value ?? 0;
    pnlUsd += pnl ?? 0;
    const outcomeIndex: 0 | 1 = r.outcomeIndex === 1 ? 1 : 0;
    return {
      marketId: r.marketId,
      providerEventId: r.providerEventId,
      league: r.league,
      label: r.label,
      side: r.side,
      state: r.state,
      startsAt: new Date(r.startsAt * 1000).toISOString(),
      tokens: usd(r.balance),
      impliedProbBps: r.impliedProbBps,
      valueUsd: value,
      entryPriceBps: r.entryPriceBps,
      pnlUsd: pnl,
      exit:
        r.side === "yes" && r.providerEventId !== null && r.state === "OPEN"
          ? {
              direction: "sell",
              providerEventId: r.providerEventId,
              outcomeIndex,
              amount: (Number(r.balance) / 1e6).toString(),
            }
          : null,
    };
  });
  return {
    positions,
    totals: {
      count: positions.length,
      valueUsd: Number(valueUsd.toFixed(2)),
      pnlUsd: Number(pnlUsd.toFixed(2)),
      unpriced,
    },
  };
}
