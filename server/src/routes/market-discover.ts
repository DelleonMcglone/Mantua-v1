import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { composeDiscoverMarkets } from "../lib/sports/market-discover.ts";
import { loadDiscoverAggregates } from "../lib/sports/market-discover-db.ts";
import type { PublicSlate } from "../lib/sports/public-slate.ts";
import type { LeagueSlug } from "../lib/sports/provider.ts";
import { readCanonicalPublicSlate } from "../lib/sports/store.ts";
import { withLiveOdds } from "../lib/sports/live-odds.ts";
import { datesToRangeMs, parseDates } from "./sports-slate.ts";

export const marketDiscoverRouter = Router();

/** The covered leagues — the same allowlist the slate route serves. */
const LEAGUES: readonly LeagueSlug[] = ["nfl"];

function isLeague(value: unknown): value is LeagueSlug {
  return typeof value === "string" && (LEAGUES as readonly string[]).includes(value);
}

/**
 * GET /api/markets/discover[?league=nfl][&dates=YYYYMMDD-YYYYMMDD] — task
 * 050 (T-018 / T-020). The public slate for each covered league, overlaid
 * with live pool odds exactly as the board is, then joined to per-market
 * liquidity and 24 h activity so the client can filter and sort on them.
 * Flat across leagues, keyed only by league + provider event id — never a
 * market id or an address. Public read, cached like the slate.
 */
marketDiscoverRouter.get("/api/markets/discover", async (req: Request, res: Response) => {
  const requested = req.query.league;
  if (requested !== undefined && !isLeague(requested)) {
    res.status(400).json({ error: "Unknown league", code: "BAD_LEAGUE" });
    return;
  }
  const leagues = isLeague(requested) ? [requested] : LEAGUES;
  const dates = parseDates(req.query.dates);
  if (dates !== null && typeof dates === "object") {
    res.status(400).json({ error: dates.error, code: "BAD_DATES" });
    return;
  }
  const range = dates === null ? undefined : (datesToRangeMs(dates) ?? undefined);

  const slates: PublicSlate[] = [];
  const failed: string[] = [];
  await Promise.all(
    leagues.map(async (league) => {
      try {
        slates.push(await withLiveOdds(await readCanonicalPublicSlate(db, league, range)));
      } catch (err) {
        logger.warn({ league, err }, "market-discover: canonical read failed");
        failed.push(league);
      }
    }),
  );
  try {
    const ids = slates.flatMap((s) => s.events.map((e) => e.providerEventId));
    const aggregates = await loadDiscoverAggregates(db, ids);
    res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
    res.json({ ...composeDiscoverMarkets(slates, aggregates), unavailable: failed });
  } catch (err) {
    logger.error({ err }, "market-discover: aggregate read failed");
    res.status(500).json({ error: "Markets unavailable", code: "INTERNAL" });
  }
});
