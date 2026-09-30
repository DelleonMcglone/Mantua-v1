/**
 * R-012 — one team key per team, whichever provider named it.
 *
 * `teamKey` (provider.ts) builds the provider-agnostic key from the league
 * and the abbreviation, on the premise that abbreviations are standard.
 * Three NFL teams break it: ESPN says WSH / JAX / LAR where Sportradar
 * says WAS / JAC / LA. Left alone, the two providers produce two `teams`
 * rows and — worse — two `events` rows for the same game, so the
 * cross-provider event match can never find its partner and the board
 * shows the game twice.
 *
 * The canonical spelling is the licensed provider's (Sportradar, D-102),
 * because that is what the persisted rows already carry. Map the other
 * spellings onto it here, in one place, before the key is built.
 */

import type { LeagueSlug } from "./provider.ts";

/** Provider spelling → canonical abbreviation, per league. Upper-case. */
const ALIASES: Partial<Record<LeagueSlug, Readonly<Record<string, string>>>> = {
  nfl: {
    WSH: "WAS",
    JAX: "JAC",
    LAR: "LA",
  },
};

/** The canonical abbreviation for a league, upper-cased and trimmed. */
export function canonicalAbbreviation(league: LeagueSlug, abbreviation: string): string {
  const upper = abbreviation.trim().toUpperCase();
  return ALIASES[league]?.[upper] ?? upper;
}
