import { logger } from "../logger.ts";
import { sharedCache } from "../shared-cache.ts";
import { providerFor } from "../sports/active-provider.ts";
import type { LeagueSlug } from "../sports/provider.ts";

/**
 * Task 072 — the D-105 season flag per game, from the provider slate the
 * sports sync registers pools with. A combo pool is playoff-priced when
 * any leg is a postseason game; absent season data means regular season
 * (the fee-free default, never the other way round).
 */

export const SEASON_CACHE_MS = 5 * 60_000;
export const LAUNCH_LEAGUE_SLUGS: readonly LeagueSlug[] = ["nfl"];

async function postseasonIds(league: LeagueSlug): Promise<string[]> {
  return sharedCache.getOrCompute(`combo-season:${league}`, SEASON_CACHE_MS, async () => {
    try {
      const slate = await providerFor(league).getSlate(league);
      return slate.events
        .filter((e) => e.seasonType === "postseason")
        .map((e) => e.providerEventId);
    } catch (err) {
      logger.warn({ league, err }, "combos: season lookup failed — regular season assumed");
      return [];
    }
  });
}

/** A lookup over every launch league, built once per request. */
export async function playoffsLookup(): Promise<(providerEventId: string) => boolean> {
  const sets = await Promise.all(LAUNCH_LEAGUE_SLUGS.map((l) => postseasonIds(l)));
  const post = new Set(sets.flat());
  return (id) => post.has(id);
}
