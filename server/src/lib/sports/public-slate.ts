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
import type { CanonicalSlate } from "./store.ts";

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
  /**
   * S-003: when the slate came from the CANONICAL tables because the
   * provider was down, this is the last-good ingest time (ms epoch) — the
   * explicit "data as of" the UI must surface. Absent on live provider
   * responses.
   */
  dataAsOf?: number;
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

/** Only https URLs pass; anything else (javascript:, data:, http:) drops. */
function publicLogo(logo: string | null | undefined): string | null {
  return typeof logo === "string" && logo.startsWith("https://") ? logo.slice(0, 300) : null;
}

function publicTeam(team: ProviderTeam): PublicTeam {
  const logo = publicLogo(team.logo);
  return {
    key: sanitizeProviderString(team.key),
    name: sanitizeProviderString(team.name),
    abbreviation: sanitizeProviderString(team.abbreviation),
    ...(logo ? { logo } : {}),
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

/**
 * How fresh a canonical ingest must be to count as live rather than
 * `delayed` (task 041). Live scores move minute-to-minute; anything the
 * ingest workers last touched more than this long ago is honestly labeled
 * delayed, with `dataAsOf` saying exactly how old it is.
 *
 * Deliberately MORE than one ingest interval: the in-play cron
 * (`.github/workflows/live-sync.yml`) fires every 5 minutes, but by its
 * own documented behavior "actual firing drifts by a few minutes under
 * load" — GitHub Actions' scheduler has no fixed-cadence guarantee. A
 * threshold equal to the interval means the label flips to "delayed" on
 * ordinary drift even when ingest never missed a beat, which is exactly
 * what was happening: the banner read "delayed" almost continuously while
 * the feed was, in fact, current. One interval of slack (2x cadence)
 * absorbs that drift while staying well inside `IN_PLAY_FEED_MAX_AGE_MS`
 * (15 min, three intervals — market-trade-build.ts's P-012 buy halt), so
 * there is still real warning room between "labeled delayed" and "buys
 * actually halted".
 */
export const CANONICAL_FRESH_MS = 10 * 60_000;

/**
 * The canonical `events` rows as a public slate.
 *
 * Task 041 made this the board's PRIMARY read (provider → ingest →
 * canonical DB → UI), not just the S-003 outage fallback. With `opts`,
 * `delayed` is computed from ingest freshness: fresh canonical data is not
 * delayed; stale (or never-ingested) data is, and `dataAsOf` is always
 * surfaced so the UI can say how old. Without `opts` the original outage
 * semantics hold — always `delayed: true`.
 *
 * Team logos come from the canonical `teams` rows joined on read (https
 * only, like every provider logo); fields the row does not keep (provider
 * record strings) are simply absent, and the board renders without them. The home-market
 * opening line (when a market was minted) fills `homeWinProbabilityBps`
 * until `withLiveOdds` overlays the live pool price.
 */
export function canonicalToPublicSlate(
  league: string,
  canonical: CanonicalSlate,
  opts?: { now?: number; freshMs?: number },
): PublicSlate {
  const now = opts?.now ?? Date.now();
  const freshMs = opts?.freshMs ?? CANONICAL_FRESH_MS;
  const delayed =
    opts === undefined || canonical.dataAsOf === null || now - canonical.dataAsOf > freshMs;
  return {
    league,
    provider: "canonical",
    delayed,
    // `fetchedAt` is when this data was last fetched from a provider — the
    // ingest time, not the DB-read time. Stable across reads of the same
    // ingest, which also lets `withLiveOdds` reuse its per-league cache.
    fetchedAt: canonical.dataAsOf ?? now,
    ...(canonical.dataAsOf !== null ? { dataAsOf: canonical.dataAsOf } : {}),
    events: canonical.events.map((row) => {
      const opening =
        row.homeOpeningProbability === null ? NaN : Number(row.homeOpeningProbability);
      const openingBps =
        Number.isFinite(opening) && opening > 0 && opening < 1
          ? Math.round(opening * 10_000)
          : undefined;
      // The provider-agnostic key is "league:ABBR" (provider.ts teamKey);
      // the suffix recovers the abbreviation for display.
      const homeAbbr = row.homeTeamKey?.split(":").at(1) ?? "";
      const awayAbbr = row.awayTeamKey?.split(":").at(1) ?? "";
      const homeLogo = publicLogo(row.homeLogo);
      const awayLogo = publicLogo(row.awayLogo);
      return {
        providerEventId: sanitizeProviderString(row.providerEventId),
        startsAt: Math.floor(row.startsAt.getTime() / 1000),
        status: sanitizeProviderString(row.status),
        home: {
          key: sanitizeProviderString(row.homeTeamKey ?? ""),
          name: sanitizeProviderString(row.homeTeam),
          abbreviation: sanitizeProviderString(homeAbbr),
          ...(homeLogo ? { logo: homeLogo } : {}),
        },
        away: {
          key: sanitizeProviderString(row.awayTeamKey ?? ""),
          name: sanitizeProviderString(row.awayTeam),
          abbreviation: sanitizeProviderString(awayAbbr),
          ...(awayLogo ? { logo: awayLogo } : {}),
        },
        ...(row.homeScore !== null ? { homeScore: row.homeScore } : {}),
        ...(row.awayScore !== null ? { awayScore: row.awayScore } : {}),
        ...(openingBps !== undefined ? { homeWinProbabilityBps: openingBps } : {}),
      };
    }),
  };
}
