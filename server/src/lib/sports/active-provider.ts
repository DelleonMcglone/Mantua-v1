/**
 * S-003 — provider selection: which adapter serves each league.
 *
 * D-102 makes Sportradar the licensed PRIMARY for the leagues its package
 * covers (NFL today); ESPN remains a prototyping-only fallback — it is the
 * undocumented backend behind espn.com, with no contract and no SLA — and
 * the WNBA source until a WNBA package is licensed. Selection is per league
 * and per boot: configure `SPORTRADAR_API_KEY` and the next process serves
 * NFL from Sportradar; unset it and everything degrades to ESPN. No code
 * change either way — that is the entire point of the B3-001 boundary.
 *
 * DM-107 is unchanged by this file: the consensus layer still corroborates
 * finals across two independent sources before settlement; this only decides
 * who is primary.
 */

import { env } from "../../env.ts";
import { EspnProvider } from "./espn.ts";
import type { LeagueSlug, SportsDataProvider } from "./provider.ts";
import { SportradarProvider } from "./sportradar.ts";

/** One ESPN instance so breaker + cache state survive across calls. */
const espn = new EspnProvider();

/** Whether the licensed provider is configured at all. */
export function sportradarConfigured(): boolean {
  return typeof env.SPORTRADAR_API_KEY === "string" && env.SPORTRADAR_API_KEY.length > 0;
}

let sportradarSingleton: SportradarProvider | null = null;

/**
 * The process-wide Sportradar adapter, or null when `SPORTRADAR_API_KEY` is
 * unset — absence degrades gracefully to the ESPN fallback, it never throws.
 * One instance so cache, pacing and breaker state survive across route
 * invocations, mirroring the ESPN singleton above.
 */
export function getSportradarProvider(): SportradarProvider | null {
  if (!sportradarConfigured()) return null;
  sportradarSingleton ??= new SportradarProvider({
    apiKey: env.SPORTRADAR_API_KEY as string,
    accessLevel: env.SPORTRADAR_ENV,
  });
  return sportradarSingleton;
}

/** The fallback adapter, exported for surfaces that explicitly want it. */
export function espnFallback(): EspnProvider {
  return espn;
}

/**
 * The primary adapter for a league: Sportradar when it is configured AND
 * covers the league, ESPN otherwise. Never throws — a missing key is a
 * degradation, not an error.
 */
export function providerFor(league: LeagueSlug): SportsDataProvider {
  const sportradar = getSportradarProvider();
  if (sportradar && (sportradar.leagues as readonly LeagueSlug[]).includes(league)) {
    return sportradar;
  }
  return espn;
}

/** Breaker state across every active adapter, for health reporting. */
export function activeBreakerState(): Record<
  string,
  Record<string, { failures: number; open: boolean }>
> {
  const out: Record<string, Record<string, { failures: number; open: boolean }>> = {
    espn: espn.breakerState(),
  };
  const sportradar = getSportradarProvider();
  if (sportradar) out["sportradar"] = sportradar.breakerState();
  return out;
}
