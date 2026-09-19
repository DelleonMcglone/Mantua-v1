import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { events, leagues, marketPrices, markets, resolutions } from "../../db/schema/index.ts";
import { computeMarketId } from "../market-id.ts";
import type { TradeGateRow } from "../sports/market-trade-build.ts";
import type { LegCandidate } from "./combo-rules.ts";

/**
 * Task 072 — leg candidates from the canonical tables: the market row, its
 * event, its league, its latest recorded price. The chain is not consulted
 * here (the recorded tick is what the trade simulation reads too); the
 * season flag comes from the caller, who has the provider slate.
 */

export interface LegRef {
  providerEventId: string;
  outcomeIndex: 0 | 1;
}

export interface LegRow {
  marketId: string;
  providerEventId: string;
  outcomeIndex: number;
  marketState: string;
  eventStatus: string;
  startsAt: Date;
  lastPolledAt: Date | null;
  homeTeam: string;
  awayTeam: string;
  league: string;
}

const SELECT = {
  marketId: markets.marketId,
  providerEventId: events.providerEventId,
  outcomeIndex: markets.outcomeIndex,
  marketState: markets.state,
  eventStatus: events.status,
  startsAt: events.startsAt,
  lastPolledAt: events.lastPolledAt,
  homeTeam: events.homeTeam,
  awayTeam: events.awayTeam,
  league: leagues.slug,
};

/** The rows for explicit leg references; a reference with no market row is absent. */
export async function readLegRows(
  db: DB,
  refs: readonly LegRef[],
  chainId: number,
): Promise<LegRow[]> {
  if (refs.length === 0) return [];
  const ids = refs.map((r) =>
    computeMarketId({
      providerEventId: r.providerEventId,
      marketType: "moneyline",
      outcomeIndex: r.outcomeIndex,
      chainId,
    }),
  );
  return db
    .select(SELECT)
    .from(markets)
    .innerJoin(events, eq(markets.eventId, events.id))
    .innerJoin(leagues, eq(events.leagueId, leagues.id))
    .where(inArray(markets.marketId, ids));
}

/** Every OPEN market whose game is upcoming or in play, for the agent's proposal. */
export async function readOpenLegRows(
  db: DB,
  nowSeconds: number,
  horizonSeconds: number,
): Promise<LegRow[]> {
  return db
    .select(SELECT)
    .from(markets)
    .innerJoin(events, eq(markets.eventId, events.id))
    .innerJoin(leagues, eq(events.leagueId, leagues.id))
    .where(
      and(
        eq(markets.state, "OPEN"),
        inArray(events.status, ["scheduled", "in_progress"]),
        gte(events.startsAt, new Date((nowSeconds - 4 * 3600) * 1000)),
        lte(events.startsAt, new Date((nowSeconds + horizonSeconds) * 1000)),
      ),
    )
    .orderBy(events.startsAt)
    .limit(200);
}

/** The latest recorded YES probability per market (any source), in bps. */
export async function latestPricesBps(
  db: DB,
  marketIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (marketIds.length === 0) return out;
  const rows = await db
    .selectDistinctOn([marketPrices.marketId], {
      marketId: marketPrices.marketId,
      p: marketPrices.impliedProbability,
    })
    .from(marketPrices)
    .where(inArray(marketPrices.marketId, [...marketIds]))
    .orderBy(marketPrices.marketId, desc(marketPrices.capturedAt));
  for (const r of rows) {
    const p = Number(r.p);
    if (Number.isFinite(p)) out.set(r.marketId, Math.round(p * 10_000));
  }
  return out;
}

/** Pure: rows + prices + season → the rule engine's candidates, in request order. */
export function legCandidatesFrom(
  rows: readonly LegRow[],
  prices: ReadonlyMap<string, number>,
  playoffsOf: (providerEventId: string) => boolean,
): LegCandidate[] {
  return rows.map((r) => {
    const home = r.outcomeIndex === 0;
    return {
      marketId: r.marketId as `0x${string}`,
      providerEventId: r.providerEventId,
      outcomeIndex: home ? 0 : 1,
      teamName: home ? r.homeTeam : r.awayTeam,
      opponentName: home ? r.awayTeam : r.homeTeam,
      league: r.league,
      kickoffAt: Math.floor(r.startsAt.getTime() / 1000),
      marketState: r.marketState,
      eventStatus: r.eventStatus,
      priceBps: prices.get(r.marketId) ?? null,
      playoffs: playoffsOf(r.providerEventId),
    };
  });
}

/** The P-012 gate row for one leg (feed-outage halt on in-play buys). */
export function legGateRow(r: LegRow): TradeGateRow {
  return {
    status: r.eventStatus,
    startsAtMs: r.startsAt.getTime(),
    lastPolledAtMs: r.lastPolledAt?.getTime() ?? null,
    marketState: r.marketState,
  };
}

/** Winning outcome per market from the resolutions log (0 = YES pays); later rows win. */
export async function winnersByMarket(
  db: DB,
  marketIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (marketIds.length === 0) return out;
  const rows = await db
    .select({ marketId: resolutions.marketId, winner: resolutions.winningOutcomeIndex })
    .from(resolutions)
    .where(inArray(resolutions.marketId, [...marketIds]))
    .orderBy(asc(resolutions.createdAt));
  for (const r of rows) if (r.winner !== null) out.set(r.marketId, r.winner);
  return out;
}
