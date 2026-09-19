import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { events, leagues, marketFills, marketPrices, markets } from "../../db/schema/markets.ts";
import { gamePlays } from "../../db/schema/sports-stats.ts";
import { BASE_CHAIN_ID } from "../chains.ts";

/**
 * Task 070 / AE-002 — the canonical-table reads behind the post
 * candidates (never a provider): open markets whose game is live or
 * within the day, then their price series, the window's fills and the
 * window's play-by-play in one round trip each.
 */

export const WINDOW_SECONDS = 3600;
export const LOOKBACK_SECONDS = 24 * 3600;
const BEFORE_KICKOFF_SECONDS = 12 * 3600;
const AFTER_KICKOFF_SECONDS = 6 * 3600;

export async function readOpenMarketRows(db: DB, nowSeconds: number) {
  return db
    .select({
      marketId: markets.marketId,
      outcomeIndex: markets.outcomeIndex,
      eventId: events.id,
      league: leagues.slug,
      homeTeam: events.homeTeam,
      awayTeam: events.awayTeam,
      status: events.status,
      homeScore: events.homeScore,
      awayScore: events.awayScore,
      startsAt: events.startsAt,
    })
    .from(markets)
    .innerJoin(events, eq(markets.eventId, events.id))
    .innerJoin(leagues, eq(events.leagueId, leagues.id))
    .where(
      and(
        eq(markets.state, "OPEN"),
        eq(markets.chainId, BASE_CHAIN_ID),
        gte(events.startsAt, new Date((nowSeconds - AFTER_KICKOFF_SECONDS) * 1000)),
        lte(events.startsAt, new Date((nowSeconds + BEFORE_KICKOFF_SECONDS) * 1000)),
      ),
    );
}

export type OpenMarketRow = Awaited<ReturnType<typeof readOpenMarketRows>>[number];

export async function readWindow(
  db: DB,
  marketIds: readonly string[],
  eventIds: readonly string[],
  nowSeconds: number,
) {
  const windowStart = new Date((nowSeconds - WINDOW_SECONDS) * 1000);
  const [prices, fills, plays] = await Promise.all([
    db
      .select({
        marketId: marketPrices.marketId,
        p: marketPrices.impliedProbability,
        liquidityRaw: marketPrices.liquidityRaw,
        capturedAt: marketPrices.capturedAt,
      })
      .from(marketPrices)
      .where(
        and(
          inArray(marketPrices.marketId, [...marketIds]),
          gte(marketPrices.capturedAt, new Date((nowSeconds - LOOKBACK_SECONDS) * 1000)),
        ),
      )
      .orderBy(asc(marketPrices.capturedAt)),
    db
      .select({ marketId: marketFills.marketId, direction: marketFills.direction })
      .from(marketFills)
      .where(
        and(inArray(marketFills.marketId, [...marketIds]), gte(marketFills.createdAt, windowStart)),
      ),
    db
      .select({ eventId: gamePlays.eventId, home: gamePlays.homeScore, away: gamePlays.awayScore })
      .from(gamePlays)
      .where(and(inArray(gamePlays.eventId, [...eventIds]), gte(gamePlays.createdAt, windowStart)))
      .orderBy(asc(gamePlays.sequence)),
  ]);
  return { prices, fills, plays };
}
