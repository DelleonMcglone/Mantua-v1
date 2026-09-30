/**
 * R-012 — a slate refresh that survives the primary provider going dark.
 *
 * Until 2026-09-30 every consumer called `refreshSlate(providerFor(league))`
 * and a primary that could not be reached failed the whole tick: the
 * Sportradar trial key ran out of its 1,000-call rolling window on
 * 2026-09-26 and the live feed stayed dark — buys halted — for four days,
 * with the ESPN adapter idle the whole time. Falling through was never
 * safe before because a second provider's slate duplicated every game
 * (event-match.ts fixes that); now it is, so this tries the providers in
 * order and reports which one served.
 */

import { logger } from "../logger.ts";
import { refreshSlate, type SlateRefreshResult } from "./ingest.ts";
import type { LeagueSlug, SportsDataProvider } from "./provider.ts";

export interface ServedSlate {
  /** The adapter whose slate was persisted — reference data and
   *  play-by-play for the same tick should come from it too. */
  served: SportsDataProvider;
  refresh: SlateRefreshResult;
  /** Providers that failed before `served` answered, by name. */
  skipped: string[];
}

/**
 * Refresh the slate from the first provider in `chain` that answers. Every
 * failure short of the last is logged and skipped; when none answers the
 * last error propagates, so the caller's failure path is unchanged.
 */
export async function refreshSlateWithFallback(
  chain: readonly SportsDataProvider[],
  league: LeagueSlug,
  nowSeconds: number,
  chainId?: number,
  dates?: string,
): Promise<ServedSlate> {
  if (chain.length === 0) throw new Error(`no provider configured for ${league}`);
  const skipped: string[] = [];
  let lastErr: unknown = null;
  for (const provider of chain) {
    try {
      const refresh = await refreshSlate(provider, league, nowSeconds, chainId, dates);
      if (skipped.length > 0) {
        logger.warn({ league, served: provider.name, skipped }, "sports: slate served by fallback");
      }
      return { served: provider, refresh, skipped };
    } catch (err) {
      lastErr = err;
      skipped.push(provider.name);
      logger.warn({ league, provider: provider.name, err }, "sports: slate provider failed");
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
