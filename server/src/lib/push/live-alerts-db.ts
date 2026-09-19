/**
 * Task 071 (MX-004) — the rows the live-sync push passes read: event
 * statuses before a write, who holds a position in a game, every open
 * held side, and the latest pool price per market. The rules are pure
 * (live-alerts.ts); the passes that join them are in live-alerts-run.ts.
 */
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { events, leagues, marketPositions, marketPrices, markets } from "../../db/schema/index.ts";
import type { HeldPosition, StatusSnapshot } from "./live-alerts.ts";

export async function eventStatuses(
  db: DB,
  provider: string,
  providerEventIds: readonly string[],
): Promise<StatusSnapshot[]> {
  if (providerEventIds.length === 0) return [];
  return db
    .select({ providerEventId: events.providerEventId, status: events.status })
    .from(events)
    .where(
      and(eq(events.provider, provider), inArray(events.providerEventId, [...providerEventIds])),
    );
}

/** Users holding an open position in any of these games, keyed by game. */
export async function holdersOf(
  db: DB,
  providerEventIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (providerEventIds.length === 0) return out;
  const rows = await db
    .selectDistinct({ providerEventId: markets.providerEventId, userId: marketPositions.userId })
    .from(marketPositions)
    .innerJoin(markets, eq(markets.marketId, marketPositions.marketId))
    .where(
      and(
        inArray(markets.providerEventId, [...providerEventIds]),
        isNull(marketPositions.settledAt),
        sql`${marketPositions.size} > 0`,
      ),
    );
  for (const r of rows) {
    if (!r.providerEventId) continue;
    out.set(r.providerEventId, [...(out.get(r.providerEventId) ?? []), r.userId]);
  }
  return out;
}

export async function heldPositions(db: DB): Promise<HeldPosition[]> {
  const rows = await db
    .select({
      userId: marketPositions.userId,
      marketId: marketPositions.marketId,
      side: marketPositions.side,
      entryPrice: marketPositions.entryPrice,
      outcomeIndex: markets.outcomeIndex,
      providerEventId: markets.providerEventId,
      homeTeam: events.homeTeam,
      awayTeam: events.awayTeam,
      league: leagues.slug,
    })
    .from(marketPositions)
    .innerJoin(markets, eq(markets.marketId, marketPositions.marketId))
    .innerJoin(events, eq(events.id, markets.eventId))
    .innerJoin(leagues, eq(leagues.id, events.leagueId))
    .where(
      and(
        eq(markets.state, "OPEN"),
        isNull(marketPositions.settledAt),
        isNotNull(marketPositions.entryPrice),
        isNotNull(markets.providerEventId),
        sql`${marketPositions.size} > 0`,
      ),
    );
  return rows.flatMap((r) =>
    r.providerEventId && (r.side === "yes" || r.side === "no")
      ? [
          {
            userId: r.userId,
            marketId: r.marketId,
            side: r.side,
            outcomeIndex: r.outcomeIndex,
            entryPrice: r.entryPrice === null ? null : Number(r.entryPrice),
            league: r.league,
            providerEventId: r.providerEventId,
            homeTeam: r.homeTeam,
            awayTeam: r.awayTeam,
          },
        ]
      : [],
  );
}

/** The latest pool observation per market, as YES-side probability 0–1. */
export async function latestPoolPrices(
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
    .where(and(eq(marketPrices.source, "pool"), inArray(marketPrices.marketId, [...marketIds])))
    .orderBy(marketPrices.marketId, desc(marketPrices.capturedAt));
  for (const r of rows) {
    const p = Number(r.p);
    if (Number.isFinite(p)) out.set(r.marketId, p);
  }
  return out;
}
