/**
 * Phase 11 (D-007) — the historical market browser's pure half: one row's
 * text, the sparkline geometry for its price path, and the league filter.
 * Rendered by `HistoryPage.tsx` and the market page's Past markets section.
 */
import type { HistoryRow } from "../detail/depth-types.ts";

export interface HistoryRowView {
  key: string;
  /** "Chiefs at Raiders" — away at home, as the board reads. */
  title: string;
  /** "KC 24 · LV 17" or null before a score is recorded. */
  finalScore: string | null;
  date: string;
  outcome: string;
  /** "Home contracts paid $1.00" / "$0.00" / "50¢" / null awaiting resolution. */
  settlement: string | null;
  /** The home side's closing implied probability, "42¢", or null. */
  closingPrice: string | null;
  tone: "home" | "away" | "void" | "pending";
}

const name = (t: HistoryRow["home"]): string => t.abbreviation ?? t.name;

export function historyRowView(r: HistoryRow): HistoryRowView {
  const tone =
    r.outcome.method === "void" || r.state === "INVALID"
      ? "void"
      : r.outcome.winningOutcomeIndex === 0
        ? "home"
        : r.outcome.winningOutcomeIndex === 1
          ? "away"
          : "pending";
  const settlement =
    r.settlementPriceBps === null
      ? null
      : r.settlementPriceBps === 5000
        ? "Both sides settled at 50¢"
        : `${r.home.name} contracts paid ${r.settlementPriceBps === 10_000 ? "$1.00" : "$0.00"}`;
  const last = r.path.at(-1);
  return {
    key: `${r.league}:${r.providerEventId}`,
    title: `${r.away.name} at ${r.home.name}`,
    finalScore:
      r.homeScore === null || r.awayScore === null
        ? null
        : `${name(r.away)} ${String(r.awayScore)} · ${name(r.home)} ${String(r.homeScore)}`,
    date: new Date(r.startsAt * 1000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    outcome: r.outcome.label,
    settlement,
    closingPrice: last ? `${String(Math.round(last.priceBps / 100))}¢` : null,
    tone,
  };
}

/** SVG polyline points for a price path in a w×h box; empty for <2 points. */
export function sparklinePoints(
  path: readonly { t: number; priceBps: number }[],
  w: number,
  h: number,
): string {
  if (path.length < 2) return "";
  const t0 = path[0]?.t ?? 0;
  const t1 = path.at(-1)?.t ?? t0 + 1;
  const span = Math.max(1, t1 - t0);
  return path
    .map((p) => {
      const x = ((p.t - t0) / span) * w;
      const y = h - (Math.min(10_000, Math.max(0, p.priceBps)) / 10_000) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function filterHistory(rows: readonly HistoryRow[], league: string | null): HistoryRow[] {
  return league === null ? [...rows] : rows.filter((r) => r.league === league);
}
