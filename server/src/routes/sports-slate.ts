import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { type PublicSlate } from "../lib/sports/public-slate.ts";
import { readCanonicalPublicSlate } from "../lib/sports/store.ts";
import { withLiveOdds } from "../lib/sports/live-odds.ts";
import type { LeagueSlug } from "../lib/sports/provider.ts";

export const sportsSlateRouter = Router();

// Task 041 (037's noted follow-through): the interactive board read now
// serves the CANONICAL tables — provider → ingest → canonical DB → UI —
// including `?dates=` browsing. ESPN/Sportradar live only inside ingestion;
// no page load reaches a provider. Freshness is explicit: `dataAsOf` is the
// last ingest time and `delayed` flips when it is stale, so old data renders
// labeled as old instead of masquerading as live (or blanking the board).
const LEAGUES: readonly LeagueSlug[] = ["nfl", "wnba"];

function isLeague(value: unknown): value is LeagueSlug {
  return typeof value === "string" && (LEAGUES as readonly string[]).includes(value);
}

/**
 * GET /api/sports/slate[?league=nfl][&dates=YYYYMMDD-YYYYMMDD] — games for
 * the board and the per-league market pages (B5-001..003).
 *
 * Public and unauthenticated by design: browsing is free, only transactions
 * need a login (B5-007). The global per-IP limiter covers abuse; the
 * canonical read is a single indexed query, and the shared CDN cache below
 * collapses board-load stampedes. Responses pass through the public-slate
 * whitelist, so provider-sourced strings are scrubbed and only whitelisted
 * fields leave (B8-008).
 */
// A week's range as YYYYMMDD-YYYYMMDD. Bounded to 31 days below so a
// crafted range can't turn one request into a season-sized query.
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

/**
 * A validated `?dates=` string → the [fromMs, toMs] window the canonical
 * read takes. The end day is inclusive (the whole UTC day), matching how
 * the ESPN scoreboard treated the range.
 */
export function datesToRangeMs(dates: string): { fromMs: number; toMs: number } | null {
  const m = DATES_RE.exec(dates);
  if (!m) return null;
  const start = parseYmd(m[1]);
  const end = parseYmd(m[2]);
  if (start === null || end === null) return null;
  return { fromMs: start, toMs: end + 86_400_000 };
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
  const range = dates === null ? undefined : (datesToRangeMs(dates) ?? undefined);

  const slates: Record<string, PublicSlate | { error: string }> = {};
  await Promise.all(
    leagues.map(async (league) => {
      try {
        const slate = await readCanonicalPublicSlate(db, league, range);
        if (slate.events.length === 0 && slate.dataAsOf === undefined) {
          // Nothing was EVER ingested for this league — that is an outage
          // (or a fresh deployment), not an off-day; keep the error contract.
          slates[league] = { error: "Slate temporarily unavailable" };
          return;
        }
        slates[league] = await withLiveOdds(slate);
      } catch (err) {
        logger.warn({ league, err }, "sports-slate: canonical read failed");
        slates[league] = { error: "Slate temporarily unavailable" };
      }
    }),
  );

  // Short shared cache: live scores move fast, but a 15s CDN hit still
  // collapses a stampede of board loads into one origin request.
  res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
  res.json({ leagues: slates });
});
