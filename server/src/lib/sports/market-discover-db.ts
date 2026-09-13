/**
 * Task 050 — the DB half of the discover read: the home moneyline market
 * per event → latest recorded pool liquidity + 24 h fills. The pure
 * composer lives in market-discover.ts.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { events, marketFills, marketPrices, markets } from "../../db/schema/index.ts";
import { DAY_MS, aggregateDiscoverFills, type DiscoverAggregate } from "./market-discover.ts";

/**
 * DB assembly: the home moneyline market per event → latest recorded
 * liquidity + 24 h fills. One query per table; events without a market
 * simply have no entry.
 */
export async function loadDiscoverAggregates(
  db: DB,
  providerEventIds: readonly string[],
  nowMs: number = Date.now(),
): Promise<Map<string, DiscoverAggregate>> {
  const out = new Map<string, DiscoverAggregate>();
  if (providerEventIds.length === 0) return out;
  const rows = await db
    .select({ marketId: markets.marketId, providerEventId: events.providerEventId })
    .from(markets)
    .innerJoin(events, eq(markets.eventId, events.id))
    .where(
      and(
        inArray(events.providerEventId, [...providerEventIds]),
        eq(markets.marketType, "moneyline"),
        eq(markets.outcomeIndex, 0),
      ),
    );
  if (rows.length === 0) return out;
  const marketIds = rows.map((r) => r.marketId);
  const [fills, prices] = await Promise.all([
    db
      .select({
        marketId: marketFills.marketId,
        usdcRaw: marketFills.usdcRaw,
        createdAt: marketFills.createdAt,
      })
      .from(marketFills)
      .where(
        and(
          inArray(marketFills.marketId, marketIds),
          gte(marketFills.createdAt, new Date(nowMs - DAY_MS)),
        ),
      ),
    db
      .select({ marketId: marketPrices.marketId, liquidityRaw: marketPrices.liquidityRaw })
      .from(marketPrices)
      .where(and(inArray(marketPrices.marketId, marketIds), eq(marketPrices.source, "pool")))
      .orderBy(desc(marketPrices.capturedAt))
      .limit(marketIds.length * 4),
  ]);
  const volume = aggregateDiscoverFills(fills, nowMs);
  const liquidity = new Map<string, string | null>();
  for (const p of prices) if (!liquidity.has(p.marketId)) liquidity.set(p.marketId, p.liquidityRaw);
  for (const r of rows) {
    const v = volume.get(r.marketId);
    out.set(r.providerEventId, {
      liquidityRaw: liquidity.get(r.marketId) ?? null,
      volume24hRaw: v?.volume24hRaw ?? 0n,
      fills24h: v?.fills24h ?? 0,
    });
  }
  return out;
}
