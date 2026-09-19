import type { DB } from "../../db/client.ts";
import { readOpenMarketRows, readWindow, WINDOW_SECONDS } from "./candidate-queries.ts";
import { explainMove, type MoveExplanation, type MoveInput } from "./explain-move.ts";
import { priceSignal, type PriceSignal } from "./price-signal.ts";
import type { MarketFacts } from "./templates.ts";

/**
 * Task 070 / AE-002 … AE-004 — which markets are worth a post right now.
 * Over the canonical-table reads in `candidate-queries.ts`: explain each
 * market's hour, grade its signal, rank by the size of the move then by
 * pool depth, and bound the tick.
 */

export interface CandidateMarket {
  facts: Omit<MarketFacts, "agentName" | "pageUrl">;
  move: MoveExplanation;
  signal: PriceSignal;
}

export const CANDIDATE_LIMIT = 5;

const status = (s: string): MoveInput["game"]["status"] =>
  s === "in_progress" ? "live" : s === "final" ? "final" : "scheduled";

export async function readCandidateMarkets(db: DB, nowSeconds: number): Promise<CandidateMarket[]> {
  const rows = await readOpenMarketRows(db, nowSeconds);
  if (rows.length === 0) return [];
  const { prices, fills, plays } = await readWindow(
    db,
    rows.map((r) => r.marketId),
    [...new Set(rows.map((r) => r.eventId))],
    nowSeconds,
  );

  const out: CandidateMarket[] = [];
  for (const r of rows) {
    const series = prices.filter((p) => p.marketId === r.marketId);
    if (series.length === 0) continue;
    const latest = series[series.length - 1];
    const oldest = series[0]; // the series is the last 24 h: "the start of today"
    const liquidityUsdc = latest.liquidityRaw === null ? null : Number(latest.liquidityRaw) / 1e6;
    const own = fills.filter((f) => f.marketId === r.marketId);
    const eventPlays = plays.filter((p) => p.eventId === r.eventId);
    const first = eventPlays.at(0);
    const last = eventPlays.at(-1);
    const home = r.outcomeIndex === 0;
    const game: MoveInput["game"] = {
      status: status(r.status),
      teamScore: home ? r.homeScore : r.awayScore,
      opponentScore: home ? r.awayScore : r.homeScore,
      scoreChanged:
        first !== undefined &&
        last !== undefined &&
        (first.home !== last.home || first.away !== last.away),
      clock: null,
    };
    const move = explainMove({
      history: series.map((p) => ({
        t: Math.floor(p.capturedAt.getTime() / 1000),
        p: Number(p.p),
      })),
      nowSeconds,
      windowSeconds: WINDOW_SECONDS,
      flow: {
        buys: own.filter((f) => f.direction === "buy").length,
        sells: own.filter((f) => f.direction === "sell").length,
      },
      game,
      liquidityUsdc,
    });
    const team = home ? r.homeTeam : r.awayTeam;
    out.push({
      facts: {
        marketId: r.marketId,
        league: r.league,
        team,
        opponent: home ? r.awayTeam : r.homeTeam,
        yesBps: move.toBps ?? Math.round(Number(latest.p) * 10_000),
        change24hBps:
          series.length > 1 ? Math.round((Number(latest.p) - Number(oldest.p)) * 10_000) : null,
        liquidityUsdc,
        startsAt: Math.floor(r.startsAt.getTime() / 1000),
        status: game.status,
        nowSeconds,
      },
      move,
      signal: priceSignal({ move, liquidityUsdc, game, team }),
    });
  }
  out.sort(
    (a, b) =>
      Math.abs(b.move.moveBps) - Math.abs(a.move.moveBps) ||
      (b.facts.liquidityUsdc ?? 0) - (a.facts.liquidityUsdc ?? 0),
  );
  return out.slice(0, CANDIDATE_LIMIT);
}
