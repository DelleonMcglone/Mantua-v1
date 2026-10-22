import type { DB } from "../../db/client.ts";
import type { LeagueSlug, ProviderSlate } from "./provider.ts";
import { espnFallback } from "./active-provider.ts";
import { upsertEvents, type UpsertResult } from "./store.ts";

/**
 * Finals the feed missed while it was dark (2026-09-26 Sportradar quota,
 * 2026-10-19 Neon quota): a game the slate stopped describing before its
 * final stays `scheduled`/`in_progress` forever, because every slate read
 * after that asks the provider for the CURRENT week. Such a row counts as
 * a game in play, so the stale-feed rule halts buys league-wide on
 * quiet days, and the market behind it never resolves.
 *
 * The daily sync re-reads the last `BACKFILL_DAYS` through ESPN's dated
 * scoreboard (the one adapter that honours a past window) and upserts
 * whatever it says, so a missed final heals within a day of the feed
 * returning. Status only — settlement is the resolution cron's job.
 */
export const BACKFILL_DAYS = 7;

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");
}

/** The `YYYYMMDD-YYYYMMDD` window ending today (UTC), `days` days long. */
export function backfillWindow(nowSeconds: number, days: number = BACKFILL_DAYS): string {
  const end = nowSeconds * 1000;
  const start = end - days * 86_400_000;
  return `${ymd(start)}-${ymd(end)}`;
}

export interface MissedFinalsDeps {
  getSlate: (league: LeagueSlug, dates: string) => Promise<ProviderSlate>;
  upsert: (
    db: DB,
    provider: string,
    league: LeagueSlug,
    events: ProviderSlate["events"],
  ) => Promise<UpsertResult>;
}

export interface MissedFinalsResult {
  window: string;
  provider: string;
  delayed: boolean;
  events: number;
  inserted: number;
  updated: number;
}

export async function backfillMissedFinals(
  db: DB,
  league: LeagueSlug,
  nowSeconds: number,
  deps: Partial<MissedFinalsDeps> = {},
): Promise<MissedFinalsResult> {
  const getSlate = deps.getSlate ?? ((l, d) => espnFallback().getSlate(l, d));
  const upsert = deps.upsert ?? upsertEvents;
  const window = backfillWindow(nowSeconds);
  const slate = await getSlate(league, window);
  const result = await upsert(db, slate.provider, league, slate.events);
  return {
    window,
    provider: slate.provider,
    delayed: slate.delayed,
    events: slate.events.length,
    inserted: result.inserted,
    updated: result.updated,
  };
}
