/**
 * Phase 11 (D-007) — the historical market browser's pure half: resolved
 * markets with their final outcome, the settlement price, and a sampled
 * price path. `market-history-db.ts` reads the rows; this file shapes them.
 */
export interface HistoryTeam {
  key: string | null;
  name: string;
  abbreviation: string | null;
}

export interface HistoryRowInput {
  league: string;
  providerEventId: string;
  home: HistoryTeam;
  away: HistoryTeam;
  startsAt: number;
  homeScore: number | null;
  awayScore: number | null;
  state: string;
  resolvedAt: number | null;
  /** From the latest resolution row; null when none is recorded yet. */
  winningOutcomeIndex: number | null;
  method: string | null;
  /** Implied probability of the home side, oldest first. */
  path: { t: number; priceBps: number }[];
}

export interface HistoryRow {
  league: string;
  providerEventId: string;
  home: HistoryTeam;
  away: HistoryTeam;
  startsAt: number;
  homeScore: number | null;
  awayScore: number | null;
  state: string;
  resolvedAt: number | null;
  outcome: { winningOutcomeIndex: 0 | 1 | null; method: string | null; label: string };
  /** What a home-side contract settled at, in cents × 100; null until resolved. */
  settlementPriceBps: number | null;
  path: { t: number; priceBps: number }[];
}

export const PATH_POINTS = 40;

/** Evenly sampled, always keeping the first and the last point. */
export function samplePath<T>(points: readonly T[], max: number = PATH_POINTS): T[] {
  if (points.length <= max) return [...points];
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) {
    const p = points[Math.round(i * step)];
    if (p !== undefined) out.push(p);
  }
  return out;
}

/** "Chiefs won" / "Voided — both sides settled at 50¢" / "Awaiting resolution". */
export function outcomeLabel(
  r: Pick<HistoryRowInput, "winningOutcomeIndex" | "method" | "home" | "away" | "state">,
): string {
  if (r.method === "void" || r.state === "INVALID") return "Voided — both sides settled at 50¢";
  if (r.winningOutcomeIndex === 0) return `${r.home.name} won`;
  if (r.winningOutcomeIndex === 1) return `${r.away.name} won`;
  return "Awaiting resolution";
}

/** Home-side settlement: $1 on a home win, $0 on an away win, 50¢ voided. */
export function settlementPriceBps(
  r: Pick<HistoryRowInput, "winningOutcomeIndex" | "method" | "state">,
): number | null {
  if (r.method === "void" || r.state === "INVALID") return 5000;
  if (r.winningOutcomeIndex === 0) return 10_000;
  if (r.winningOutcomeIndex === 1) return 0;
  return null;
}

export function toHistoryRow(r: HistoryRowInput): HistoryRow {
  const winning =
    r.winningOutcomeIndex === 0 || r.winningOutcomeIndex === 1 ? r.winningOutcomeIndex : null;
  return {
    league: r.league,
    providerEventId: r.providerEventId,
    home: r.home,
    away: r.away,
    startsAt: r.startsAt,
    homeScore: r.homeScore,
    awayScore: r.awayScore,
    state: r.state,
    resolvedAt: r.resolvedAt,
    outcome: { winningOutcomeIndex: winning, method: r.method, label: outcomeLabel(r) },
    settlementPriceBps: settlementPriceBps(r),
    path: samplePath(r.path),
  };
}
