/**
 * The full NFL season schedule in the canonical events table.
 *
 * The slate sync keeps this week and next. That is all trading needs, but
 * it left the analyst unable to answer "do the Browns and Steelers play
 * again?". Once a day the sports sync pulls every week of the season from
 * the same free ESPN scoreboard the slate fallback uses and stores the games
 * the slate sync does not already own. Storing a game creates no market:
 * markets are planned only from the slate (ingest.ts), never from this.
 */
import type { DB } from "../../db/client.ts";
import { logger } from "../logger.ts";
import { parseSlate } from "./espn.ts";
import type { ProviderEvent } from "./provider.ts";
import { upsertEvents } from "./store.ts";

const HOST = "https://site.api.espn.com";
const PATH = "/apis/site/v2/sports/football/nfl/scoreboard";
/** ESPN season types: 2 regular season (18 weeks), 3 postseason (5 rounds). */
const WEEKS: readonly { seasonType: 2 | 3; weeks: number }[] = [
  { seasonType: 2, weeks: 18 },
  { seasonType: 3, weeks: 5 },
];
/** Games starting within this window belong to the slate sync, which keeps
 *  their status, scores and odds live; the season pass leaves them alone. */
export const SLATE_OWNED_SECONDS = 9 * 86_400;

type Fetcher = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** Every game ESPN lists for the season, one request per week. A week that
 *  fails or is not scheduled yet contributes nothing. */
export async function fetchSeasonSchedule(fetcher: Fetcher = fetch): Promise<ProviderEvent[]> {
  const byId = new Map<string, ProviderEvent>();
  for (const { seasonType, weeks } of WEEKS) {
    for (let week = 1; week <= weeks; week++) {
      try {
        const res = await fetcher(
          `${HOST}${PATH}?seasontype=${String(seasonType)}&week=${String(week)}`,
        );
        if (!res.ok) continue;
        for (const e of parseSlate(await res.json(), "nfl")) byId.set(e.providerEventId, e);
      } catch (err) {
        logger.warn({ err, seasonType, week }, "season-schedule: week fetch failed");
      }
    }
  }
  return [...byId.values()];
}

/** The games the season pass may store: those the slate sync does not own. */
export function beyondSlate(events: readonly ProviderEvent[], nowSeconds: number): ProviderEvent[] {
  return events.filter((e) => e.startsAt > nowSeconds + SLATE_OWNED_SECONDS);
}

export async function refreshSeasonSchedule(
  db: DB,
  nowSeconds: number,
  fetcher: Fetcher = fetch,
): Promise<{ fetched: number; stored: number; inserted: number; updated: number }> {
  const all = await fetchSeasonSchedule(fetcher);
  const mine = beyondSlate(all, nowSeconds);
  const result = await upsertEvents(db, "espn", "nfl", mine);
  return {
    fetched: all.length,
    stored: mine.length,
    inserted: result.inserted,
    updated: result.updated,
  };
}
