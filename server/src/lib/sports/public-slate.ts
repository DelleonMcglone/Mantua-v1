/**
 * B5-002/B5-003 — the public shape of a slate, for the board and the
 * per-league market pages.
 *
 * Serialization is a whitelist, not a passthrough: only the fields the UI
 * renders leave the server, so a provider adding fields (or a parser bug
 * letting extras through) can't quietly widen the public API.
 *
 * Every provider string is scrubbed on the way out (B8-008). Team names come
 * from an external feed and end up in two risky places: rendered markup and —
 * once "analyze this matchup" exists — the text of prompts to a model. React
 * escapes markup; nothing escapes a prompt. So the server caps length and
 * strips control characters and angle brackets here, once, rather than
 * trusting every downstream consumer to remember.
 */

import type { ProviderEvent, ProviderSlate, ProviderTeam } from "./provider.ts";

export interface PublicTeam {
  key: string;
  name: string;
  abbreviation: string;
  logo?: string;
  /** Season win–loss record ("31-7") from the provider, when published. */
  record?: string;
}

export interface PublicEvent {
  providerEventId: string;
  startsAt: number;
  status: string;
  home: PublicTeam;
  away: PublicTeam;
  homeScore?: number;
  awayScore?: number;
  homeWinProbabilityBps?: number;
  /** True when homeWinProbabilityBps is the on-chain pool price, not the
   *  provider's line (live-odds.ts). */
  liveOdds?: boolean;
}

export interface PublicSlate {
  league: string;
  provider: string;
  /** Served from a degraded path — show it as delayed, never as live. */
  delayed: boolean;
  fetchedAt: number;
  events: PublicEvent[];
}

const MAX_STRING = 80;

/** Strip control chars and angle brackets; collapse whitespace; cap length. */
export function sanitizeProviderString(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      // Whitespace-class controls become separators (collapsed below);
      // dropping them outright would glue adjacent words together.
      if (ch === "\n" || ch === "\t" || ch === "\r") out += " ";
      continue;
    }
    if (ch === "<" || ch === ">") continue;
    out += ch;
  }
  return out.replaceAll(/\s+/g, " ").trim().slice(0, MAX_STRING);
}

function publicTeam(team: ProviderTeam): PublicTeam {
  const logo = typeof team.logo === "string" && team.logo.startsWith("https://") ? team.logo : null;
  return {
    key: sanitizeProviderString(team.key),
    name: sanitizeProviderString(team.name),
    abbreviation: sanitizeProviderString(team.abbreviation),
    // Only https URLs pass; anything else (javascript:, data:, http:) drops.
    ...(logo ? { logo: logo.slice(0, 300) } : {}),
    ...(typeof team.record === "string" && /^\d{1,3}-\d{1,3}$/.test(team.record)
      ? { record: team.record }
      : {}),
  };
}

function publicEvent(event: ProviderEvent): PublicEvent {
  return {
    providerEventId: sanitizeProviderString(event.providerEventId),
    startsAt: event.startsAt,
    status: event.status,
    home: publicTeam(event.home),
    away: publicTeam(event.away),
    ...(typeof event.homeScore === "number" ? { homeScore: event.homeScore } : {}),
    ...(typeof event.awayScore === "number" ? { awayScore: event.awayScore } : {}),
    ...(typeof event.homeWinProbabilityBps === "number"
      ? { homeWinProbabilityBps: event.homeWinProbabilityBps }
      : {}),
  };
}

export function toPublicSlate(slate: ProviderSlate): PublicSlate {
  return {
    league: slate.league,
    provider: slate.provider,
    delayed: slate.delayed,
    fetchedAt: slate.fetchedAt,
    events: slate.events.map(publicEvent),
  };
}
