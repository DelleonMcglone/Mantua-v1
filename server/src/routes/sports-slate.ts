import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { espnFallback } from "../lib/sports/active-provider.ts";
import {
  canonicalToPublicSlate,
  toPublicSlate,
  type PublicSlate,
} from "../lib/sports/public-slate.ts";
import { readCanonicalSlate } from "../lib/sports/store.ts";
import { withLiveOdds } from "../lib/sports/live-odds.ts";
import type { LeagueSlug } from "../lib/sports/provider.ts";

export const sportsSlateRouter = Router();

// The interactive board read stays on the ESPN adapter: its `?dates=` range
// browsing is an ESPN-specific extension, and a Sportradar TRIAL key's
// 1,000-calls/30-days quota belongs to ingestion, not to page loads. The
// canonical tables (fed by Sportradar when licensed — S-003) are the outage
// fallback below, and the intended end-state primary read per the phase's
// provider → ingest → canonical DB → UI rule.
const espn = espnFallback();
const LEAGUES: readonly LeagueSlug[] = ["nfl", "wnba"];

function isLeague(value: unknown): value is LeagueSlug {
  return typeof value === "string" && (LEAGUES as readonly string[]).includes(value);
}

/**
 * GET /api/sports/slate[?league=nfl] — today's games for the board and the
 * per-league market pages (B5-001..003).
 *
 * Public and unauthenticated by design: browsing is free, only transactions
 * need a login (B5-007). The global per-IP limiter covers abuse; the
 * provider's own TTL cache means a burst of board loads costs one upstream
 * fetch. Responses pass through `toPublicSlate`, so provider strings are
 * scrubbed and only whitelisted fields leave (B8-008).
 *
 * A league whose fetch fails reports `error` for that league while the others
 * still render — one upstream outage must not blank the whole board.
 */
// A week's range as YYYYMMDD-YYYYMMDD. Bounded to 31 days below so a
// crafted range can't turn one request into a season-sized upstream fetch.
const DATES_RE = /^(\d{8})-(\d{8})$/;
const MAX_RANGE_DAYS = 31;

function parseYmd(ymd: string): number | null {
  const t = Date.parse(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

/** Validated `?dates=` range, or null when absent, or an error string. */
export function parseDates(raw: unknown): string | null | { error: string } {
  if (raw === undefined) return null;
  if (typeof raw !== "string") return { error: "dates must be YYYYMMDD-YYYYMMDD" };
  const m = DATES_RE.exec(raw);
  if (!m) return { error: "dates must be YYYYMMDD-YYYYMMDD" };
  const start = parseYmd(m[1]);
  const end = parseYmd(m[2]);
  if (start === null || end === null || end < start) return { error: "dates range is invalid" };
  if (end - start > MAX_RANGE_DAYS * 86_400_000) return { error: "dates range is too long" };
  return raw;
}

sportsSlateRouter.get("/api/sports/slate", async (req: Request, res: Response) => {
  const requested = req.query.league;
  if (requested !== undefined && !isLeague(requested)) {
    res.status(400).json({ error: "Unknown league", code: "BAD_LEAGUE" });
    return;
  }
  const leagues = requested !== undefined && isLeague(requested) ? [requested] : LEAGUES;

  const dates = parseDates(req.query.dates);
  if (dates !== null && typeof dates === "object") {
    res.status(400).json({ error: dates.error, code: "BAD_DATES" });
    return;
  }

  const slates: Record<string, PublicSlate | { error: string }> = {};
  await Promise.all(
    leagues.map(async (league) => {
      try {
        slates[league] = await withLiveOdds(
          toPublicSlate(await espn.getSlate(league, dates ?? undefined)),
        );
      } catch (err) {
        logger.warn({ league, err }, "sports-slate: fetch failed");
        // S-003 outage path: the provider is down AND its stale-grace cache
        // is exhausted — serve last-good canonical rows with an explicit
        // `dataAsOf` instead of blanking the league. An empty canonical
        // table (nothing ever ingested) still reports the error.
        try {
          const canonical = await readCanonicalSlate(db, league);
          if (canonical.events.length > 0) {
            slates[league] = canonicalToPublicSlate(league, canonical);
            return;
          }
        } catch (fallbackErr) {
          logger.warn({ league, err: fallbackErr }, "sports-slate: canonical fallback failed");
        }
        slates[league] = { error: "Slate temporarily unavailable" };
      }
    }),
  );

  // Short shared cache: live scores move fast, but a 15s CDN hit still
  // collapses a stampede of board loads into one origin request.
  res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
  res.json({ leagues: slates });
});
