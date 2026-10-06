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

/**
 * R-012 — the providers to try, in order, for a daily/settlement read:
 * the licensed primary first, ESPN behind it. A primary that is down (or,
 * on a trial key, out of quota) no longer darkens the feed — the
 * cross-provider event match makes the fallback's rows land on the same
 * games. Never empty: ESPN is always last.
 */
export function providerChainFor(league: LeagueSlug): SportsDataProvider[] {
  const primary = providerFor(league);
  return primary === espn ? [espn] : [primary, espn];
}

/**
 * R-012 — the providers for the five-minute live tick. A Sportradar TRIAL
 * key is capped at 1,000 calls per rolling 30 days; the live tick alone
 * makes ~300 a day, which is how the feed went dark on 2026-09-26. On a
 * trial key the tick reads ESPN only and leaves the quota to the daily
 * sync, reference data and settlement (~10 calls a day). On a production
 * key Sportradar serves live, with ESPN behind it.
 */
export function liveProviderChainFor(league: LeagueSlug): SportsDataProvider[] {
  if (env.SPORTRADAR_ENV !== "production") return [espn];
  return providerChainFor(league);
}

/**
 * The source for reference data (injuries, standings): ESPN on a trial
 * Sportradar key — its endpoints are free and unmetered, where the trial
 * quota starved these feeds in production (owner report 2026-10-05) —
 * and the provider that served the slate on a production key.
 */
export function referenceProviderFor(served: SportsDataProvider): SportsDataProvider {
  return env.SPORTRADAR_ENV !== "production" ? espn : served;
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
