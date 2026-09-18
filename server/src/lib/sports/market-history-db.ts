/**
 * Phase 11 (D-007) — reads resolved moneyline markets (home side) with their
 * event, league, latest resolution, and recorded price path, and shapes
 * them through `market-history.ts`.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { db as defaultDb } from "../../db/client.ts";
import {
  events,
  leagues,
  marketPrices,
  markets,
  resolutions,
  teams,
} from "../../db/schema/index.ts";
import { toHistoryRow, type HistoryRow, type HistoryRowInput } from "./market-history.ts";

export const HISTORY_STATES = ["RESOLVED", "SETTLED", "INVALID"] as const;
const PRICE_ROWS_CAP = 4000;

export interface HistoryQuery {
  league: string | null;
  limit: number;
}

export async function readMarketHistory(
  q: HistoryQuery,
  db: DB = defaultDb,
): Promise<HistoryRow[]> {
  const where = [
    eq(markets.marketType, "moneyline"),
    eq(markets.outcomeIndex, 0),
    inArray(markets.state, [...HISTORY_STATES]),
    ...(q.league ? [eq(leagues.slug, q.league)] : []),
  ];
  const rows = await db
    .select({ market: markets, event: events, league: leagues.slug })
    .from(markets)
    .innerJoin(events, eq(markets.eventId, events.id))
    .innerJoin(leagues, eq(events.leagueId, leagues.id))
    .where(and(...where))
    .orderBy(desc(markets.resolvedAt), desc(events.startsAt))
    .limit(q.limit);
  if (rows.length === 0) return [];

  const marketIds = rows.map((r) => r.market.marketId);
  const teamIds = [
    ...new Set(rows.flatMap((r) => [r.event.homeTeamId, r.event.awayTeamId])),
  ].filter((t): t is string => t !== null);
  const [resolutionRows, priceRows, teamRows] = await Promise.all([
    db
      .select()
      .from(resolutions)
      .where(inArray(resolutions.marketId, marketIds))
      .orderBy(desc(resolutions.createdAt)),
    db
      .select({
        marketId: marketPrices.marketId,
        p: marketPrices.impliedProbability,
        at: marketPrices.capturedAt,
      })
      .from(marketPrices)
      .where(inArray(marketPrices.marketId, marketIds))
      .orderBy(asc(marketPrices.capturedAt))
      .limit(PRICE_ROWS_CAP),
    teamIds.length
      ? db
          .select({ id: teams.id, abbreviation: teams.abbreviation })
          .from(teams)
          .where(inArray(teams.id, teamIds))
      : Promise.resolve([]),
  ]);
  const latestResolution = new Map<string, (typeof resolutionRows)[number]>();
  for (const r of resolutionRows)
    if (!latestResolution.has(r.marketId)) latestResolution.set(r.marketId, r);
  const paths = new Map<string, { t: number; priceBps: number }[]>();
  for (const p of priceRows) {
    const v = Number(p.p);
    if (!Number.isFinite(v)) continue;
    const list = paths.get(p.marketId) ?? [];
    list.push({
      t: Math.floor(p.at.getTime() / 1000),
      priceBps: Math.round(Math.min(1, Math.max(0, v)) * 10_000),
    });
    paths.set(p.marketId, list);
  }
  const abbr = (id: string | null) => teamRows.find((t) => t.id === id)?.abbreviation ?? null;

  return rows.map((r) => {
    const res = latestResolution.get(r.market.marketId);
    const input: HistoryRowInput = {
      league: r.league,
      providerEventId: r.event.providerEventId,
      home: {
        key: r.event.homeTeamKey,
        name: r.event.homeTeam,
        abbreviation: abbr(r.event.homeTeamId),
      },
      away: {
        key: r.event.awayTeamKey,
        name: r.event.awayTeam,
        abbreviation: abbr(r.event.awayTeamId),
      },
      startsAt: Math.floor(r.event.startsAt.getTime() / 1000),
      homeScore: r.event.homeScore,
      awayScore: r.event.awayScore,
      state: r.market.state,
      resolvedAt: r.market.resolvedAt ? Math.floor(r.market.resolvedAt.getTime() / 1000) : null,
      winningOutcomeIndex: res?.winningOutcomeIndex ?? null,
      method: res?.method ?? null,
      path: paths.get(r.market.marketId) ?? [],
    };
    return toHistoryRow(input);
  });
}
