/**
 * Prompt 6 — "Find today's biggest probability gaps." Every priced market
 * in the window gets the same sports_intelligence estimate the single-game
 * analysis uses; the markets are then ranked by how far that estimate sits
 * from the pool's price. Read-only; the ranking itself is pure.
 */
import { analyzeMarket, type EventRow, type SportsToolsDb } from "./agent-sports-tools.ts";

export interface GapRow {
  game: string;
  providerEventId: string;
  outcome: string;
  marketId: string;
  marketProbabilityBps: number;
  mantuaProbabilityBps: number;
  /** mantua − market, in percentage points (one decimal). */
  gapPoints: number;
  confidence: string;
  liquidityUsdc: number | null;
  drivers: string[];
}

/** Largest absolute gap first; ties by liquidity (deeper first). */
export function rankGaps(rows: readonly GapRow[], limit: number): GapRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        Math.abs(b.gapPoints) - Math.abs(a.gapPoints) ||
        (b.liquidityUsdc ?? 0) - (a.liquidityUsdc ?? 0),
    )
    .slice(0, limit);
}

export function gapRowFromAnalysis(event: EventRow, a: Record<string, unknown>): GapRow | null {
  const market = a["market"] as {
    marketId: string;
    impliedProbabilityBps: number | null;
    liquidityUsdc: number | null;
  } | null;
  const analysis = a["analysis"] as
    | { probabilityBps: number; confidence: string; evidence: { factor: string; detail: string }[] }
    | undefined;
  if (!market || market.impliedProbabilityBps === null || !analysis) return null;
  return {
    game: `${event.awayTeam} at ${event.homeTeam}`,
    providerEventId: event.providerEventId,
    outcome: typeof a["team"] === "string" ? a["team"] : event.homeTeam,
    marketId: market.marketId,
    marketProbabilityBps: market.impliedProbabilityBps,
    mantuaProbabilityBps: analysis.probabilityBps,
    gapPoints: Math.round((analysis.probabilityBps - market.impliedProbabilityBps) / 10) / 10,
    confidence: analysis.confidence,
    liquidityUsdc: market.liquidityUsdc,
    drivers: analysis.evidence.slice(0, 4).map((e) => `${e.factor}: ${e.detail}`),
  };
}

const DEFAULT_WINDOW_HOURS = 36;

export async function scanProbabilityGaps(
  dbx: SportsToolsDb,
  input: { league?: unknown; limit?: unknown; windowHours?: unknown },
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const slug = typeof input.league === "string" ? input.league : "nfl";
  const limit = Math.min(10, Math.max(1, Number(input.limit) || 5));
  const hours = Math.min(168, Math.max(1, Number(input.windowHours) || DEFAULT_WINDOW_HOURS));
  const league = (await dbx.listLeagues()).find((l) => l.slug === slug);
  if (!league) return { status: "unknown_league", league: slug };
  const from = now.getTime() - 4 * 3_600_000;
  const to = now.getTime() + hours * 3_600_000;
  const events = (await dbx.listEventsForLeague(league.id, 500)).filter(
    (e) =>
      (e.status === "scheduled" || e.status === "in_progress") &&
      e.startsAt.getTime() >= from &&
      e.startsAt.getTime() <= to,
  );
  const rows: GapRow[] = [];
  let unpriced = 0;
  for (const event of events) {
    const a = await analyzeMarket(
      dbx,
      { providerEventId: event.providerEventId, outcomeIndex: 0 },
      now,
    );
    const row = a["status"] === "ok" ? gapRowFromAnalysis(event, a) : null;
    if (row) rows.push(row);
    else unpriced += 1;
  }
  return {
    status: "ok",
    windowHours: hours,
    scanned: events.length,
    unpriced,
    gaps: rankGaps(rows, limit),
    note: "gapPoints = Mantua's estimate minus the market, in percentage points; the outcome is the home side — the away side's gap is the negative. Estimates are evidence-weighted, not predictions.",
  };
}
