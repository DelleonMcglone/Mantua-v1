import { Router, type Request, type Response } from "express";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { events, leagues, markets, sports } from "../db/schema/index.ts";
import { DEFAULT_CHAIN_ID } from "../lib/chains.ts";
import { logger } from "../lib/logger.ts";
import { MARKETS_BY_CHAIN } from "../lib/markets-contracts.ts";

export const marketPoolsRouter = Router();

/**
 * B7-006 — GET /api/markets/pools: the pool↔market linkage the pool list
 * joins its market-status column on. One row per market that has a seeded
 * YES/USDC pool (`markets.poolId` set), carrying the market's lifecycle
 * state (OPEN | FROZEN | RESOLVED | SETTLED | INVALID) and enough event
 * context to label the row.
 *
 * The B7-006 edge case is the contract here: with no markets deployed the
 * list is EMPTY (`pools: []`), and the client renders no market-status
 * column at all — absent, not blank. `marketsDeployed` additionally tells
 * the liquidity surface whether market-pool actions are gated (B7-004)
 * without paying an RPC round-trip.
 *
 * Public read, like the slate — the pool list renders logged-out.
 */
marketPoolsRouter.get("/api/markets/pools", async (_req: Request, res: Response) => {
  const marketsDeployed = MARKETS_BY_CHAIN[DEFAULT_CHAIN_ID] !== undefined;
  try {
    const rows = await db
      .select({
        marketId: markets.marketId,
        poolId: markets.poolId,
        state: markets.state,
        outcomeIndex: markets.outcomeIndex,
        chainId: markets.chainId,
        providerEventId: events.providerEventId,
        homeTeam: events.homeTeam,
        awayTeam: events.awayTeam,
        startsAt: events.startsAt,
        league: leagues.slug,
        sport: sports.slug,
      })
      .from(markets)
      .innerJoin(events, eq(markets.eventId, events.id))
      .innerJoin(leagues, eq(events.leagueId, leagues.id))
      .innerJoin(sports, eq(leagues.sportId, sports.id))
      .where(isNotNull(markets.poolId))
      .limit(500);
    res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
    res.json({
      marketsDeployed,
      pools: rows.map((r) => ({
        marketId: r.marketId,
        poolId: r.poolId,
        state: r.state,
        outcomeIndex: r.outcomeIndex,
        chainId: r.chainId,
        providerEventId: r.providerEventId,
        // The YES side this pool prices: outcome 0 = home, 1 = away.
        label: r.outcomeIndex === 0 ? r.homeTeam : r.awayTeam,
        event: `${r.awayTeam} @ ${r.homeTeam}`,
        startsAt: Math.floor(r.startsAt.getTime() / 1000),
        league: r.league,
        sport: r.sport,
      })),
    });
  } catch (err) {
    // Best-effort: the pool list must render even when the DB is
    // unreachable — an empty join means "no market column", not a
    // broken page.
    logger.warn({ err }, "GET /api/markets/pools failed — returning empty join");
    res.json({ marketsDeployed, pools: [] });
  }
});
