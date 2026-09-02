/**
 * B3-002 / B3-004 — the ESPN adapter, and the normalization from ESPN's shape
 * to `ProviderEvent`.
 *
 * ESPN retired its public developer API in 2014. `site.api.espn.com` is the
 * undocumented JSON backend behind espn.com: free, keyless, comprehensive, and
 * entirely without guarantees. Everything defensive in this file follows from
 * that — fields are read as `unknown` and validated, never trusted by shape.
 *
 * The one thing this adapter must never do is guess. An unrecognised status
 * maps to `"unknown"` rather than to the nearest plausible value, because
 * `isSettleable` only accepts `"final"` and spec §3.5 requires that missing
 * information block settlement instead of resolving a market on a hunch.
 */

import {
  type LeagueSlug,
  type ProviderEvent,
  type ProviderEventStatus,
  type ProviderSlate,
  type ProviderTeam,
  type SportsDataProvider,
  ProviderShapeError,
  teamKey,
} from "./provider.ts";
import { LIVE_TTL_MS, PREGAME_TTL_MS, ResilientJson } from "./resilience.ts";

/** ESPN's path segment per league — mirrors `leagues.provider_key` in the DB. */
const LEAGUE_PATH: Record<LeagueSlug, string> = {
  nfl: "football/nfl",
  wnba: "basketball/wnba",
};

/**
 * ESPN's `type.state` is a three-value field: `pre`, `in`, `post`. It alone
 * cannot distinguish a finished game from a cancelled one, so the more specific
 * `type.name` is checked first and `state` is only the fallback.
 */
const STATUS_BY_NAME: Partial<Record<string, ProviderEventStatus>> = {
  STATUS_SCHEDULED: "scheduled",
  STATUS_IN_PROGRESS: "in_progress",
  STATUS_HALFTIME: "in_progress",
  STATUS_END_PERIOD: "in_progress",
  STATUS_FINAL: "final",
  STATUS_FINAL_OVERTIME: "final",
  STATUS_POSTPONED: "postponed",
  STATUS_CANCELED: "cancelled",
  STATUS_SUSPENDED: "postponed",
  STATUS_DELAYED: "scheduled",
};

const STATUS_BY_STATE: Partial<Record<string, ProviderEventStatus>> = {
  pre: "scheduled",
  in: "in_progress",
  post: "final",
};

export function mapStatus(name: unknown, state: unknown): ProviderEventStatus {
  if (typeof name === "string") {
    const byName = STATUS_BY_NAME[name.toUpperCase()];
    if (byName) return byName;
  }
  if (typeof state === "string") {
    const byState = STATUS_BY_STATE[state.toLowerCase()];
    // `post` means "after the scheduled window", which a cancelled game also
    // satisfies. Only trust it when the name gave us nothing at all, and never
    // let it upgrade an unrecognised name to settleable.
    if (byState && !(byState === "final" && typeof name === "string")) return byState;
  }
  return "unknown";
}

/** Ids arrive as strings or numbers; anything else is treated as absent. */
function asId(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseTeam(competitor: Record<string, unknown>, league: LeagueSlug): ProviderTeam {
  const team = asRecord(competitor["team"]);
  if (!team) throw new ProviderShapeError("competitor has no team object");

  const abbreviation = typeof team["abbreviation"] === "string" ? team["abbreviation"] : "";
  const providerId = asId(team["id"]);
  if (abbreviation === "" || providerId === "") {
    throw new ProviderShapeError("team missing id or abbreviation");
  }

  const logo = typeof team["logo"] === "string" ? team["logo"] : undefined;
  // ESPN's first records entry is the overall season summary ("31-7").
  let record: string | undefined;
  const records = competitor["records"];
  if (Array.isArray(records)) {
    const overall = asRecord(records[0]);
    const summary = overall?.["summary"];
    if (typeof summary === "string" && /^\d{1,3}-\d{1,3}$/.test(summary)) record = summary;
  }
  return {
    providerId,
    key: teamKey(league, abbreviation),
    name: typeof team["displayName"] === "string" ? team["displayName"] : abbreviation,
    abbreviation,
    ...(logo ? { logo } : {}),
    ...(record ? { record } : {}),
  };
}

/**
 * Home-win probability from ESPN's odds block, in bps.
 *
 * ESPN publishes this inconsistently — sometimes as a percentage, sometimes
 * absent, sometimes only for one side. A value outside a sane range is dropped
 * rather than clamped, because a bad opening probability seeds the pool at the
 * wrong price (B1-009) and 50/50 is a more honest default than a rescued
 * number.
 */
export function parseHomeWinProbabilityBps(
  competition: Record<string, unknown>,
): number | undefined {
  const odds = competition["odds"];
  if (!Array.isArray(odds) || odds.length === 0) return undefined;
  const first = asRecord(odds[0]);
  if (!first) return undefined;

  const prob = asRecord(first["homeTeamOdds"]);
  const pct = asNumber(prob?.["winPercentage"]) ?? asNumber(first["homeWinPercentage"]);
  if (pct === undefined) return undefined;
  if (pct <= 0 || pct >= 100) return undefined;
  return Math.round(pct * 100);
}

/** Normalize one ESPN `events[]` entry (B3-004). */
export function parseEvent(raw: unknown, league: LeagueSlug): ProviderEvent {
  const event = asRecord(raw);
  if (!event) throw new ProviderShapeError("event is not an object");

  const providerEventId = asId(event["id"]);
  if (providerEventId === "") throw new ProviderShapeError("event has no id");

  const date = typeof event["date"] === "string" ? Date.parse(event["date"]) : Number.NaN;
  if (!Number.isFinite(date)) throw new ProviderShapeError("event has no parseable date");

  const competitions = event["competitions"];
  const competition = Array.isArray(competitions) ? asRecord(competitions[0]) : null;
  if (!competition) throw new ProviderShapeError("event has no competition");

  const competitors = competition["competitors"];
  if (!Array.isArray(competitors) || competitors.length < 2) {
    throw new ProviderShapeError("competition has fewer than two competitors");
  }

  // Home/away come from the explicit flag, never from array order — ordering is
  // not documented, and a silent swap would invert every market's outcome index
  // (see `docs/specs/market-id.md`).
  let homeRaw: Record<string, unknown> | null = null;
  let awayRaw: Record<string, unknown> | null = null;
  for (const c of competitors) {
    const rec = asRecord(c);
    if (!rec) continue;
    if (rec["homeAway"] === "home") homeRaw = rec;
    else if (rec["homeAway"] === "away") awayRaw = rec;
  }
  if (!homeRaw || !awayRaw) throw new ProviderShapeError("could not identify home and away");

  const statusRec = asRecord(competition["status"]) ?? asRecord(event["status"]);
  const typeRec = asRecord(statusRec?.["type"]);
  const status = mapStatus(typeRec?.["name"], typeRec?.["state"]);

  const homeScore = asNumber(homeRaw["score"]);
  const awayScore = asNumber(awayRaw["score"]);
  const probBps = parseHomeWinProbabilityBps(competition);

  return {
    providerEventId,
    league,
    startsAt: Math.floor(date / 1000),
    status,
    home: parseTeam(homeRaw, league),
    away: parseTeam(awayRaw, league),
    ...(homeScore !== undefined ? { homeScore } : {}),
    ...(awayScore !== undefined ? { awayScore } : {}),
    ...(probBps !== undefined ? { homeWinProbabilityBps: probBps } : {}),
  };
}

/**
 * Parse a scoreboard payload, skipping individual malformed events.
 *
 * One unparseable game must not lose the whole slate: ESPN occasionally emits a
 * placeholder entry for an unannounced matchup, and dropping the slate over it
 * would stop every other market being created.
 */
export function parseSlate(payload: unknown, league: LeagueSlug): ProviderEvent[] {
  const root = asRecord(payload);
  const events = root?.["events"];
  if (!Array.isArray(events)) throw new ProviderShapeError("payload has no events array");

  const out: ProviderEvent[] = [];
  for (const raw of events) {
    try {
      out.push(parseEvent(raw, league));
    } catch {
      // Intentionally swallowed — see the note above.
    }
  }
  return out;
}

const ESPN_HOSTS = ["https://site.api.espn.com", "https://site.web.api.espn.com"] as const;

export class EspnProvider implements SportsDataProvider {
  readonly name = "espn";
  readonly leagues = ["nfl", "wnba"] as const;

  private readonly http: ResilientJson;

  constructor(fetchImpl?: typeof fetch) {
    this.http = new ResilientJson(ESPN_HOSTS, fetchImpl);
  }

  breakerState(): Record<string, { failures: number; open: boolean }> {
    return this.http.breakerState();
  }

  async getSlate(league: LeagueSlug, dates?: string): Promise<ProviderSlate> {
    // `dates` is a pre-validated YYYYMMDD-YYYYMMDD range (see the slate
    // route); ESPN's scoreboard accepts it on every league. Omitted = the
    // provider default, which is today for daily leagues (WNBA) but the
    // CURRENT SCHEDULE WEEK for the NFL — midweek that is mostly finished
    // games, so surfaces that want upcoming games must pass a range.
    const suffix = dates ? `?dates=${dates}` : "";
    const path = `/apis/site/v2/sports/${LEAGUE_PATH[league]}/scoreboard${suffix}`;
    const res = await this.http.get<unknown>(
      `espn:slate:${league}:${dates ?? "today"}`,
      path,
      PREGAME_TTL_MS,
    );
    return {
      provider: this.name,
      league,
      events: parseSlate(res.value, league),
      delayed: res.delayed,
      fetchedAt: res.fetchedAt,
    };
  }

  async getEvent(league: LeagueSlug, providerEventId: string): Promise<ProviderEvent | null> {
    // Live games get the short TTL; the summary endpoint is the one that
    // carries in-progress scores.
    const path = `/apis/site/v2/sports/${LEAGUE_PATH[league]}/summary?event=${encodeURIComponent(providerEventId)}`;
    const res = await this.http.get<unknown>(
      `espn:event:${league}:${providerEventId}`,
      path,
      LIVE_TTL_MS,
    );

    const root = asRecord(res.value);
    const header = asRecord(root?.["header"]);
    if (!header) return null;

    // The summary endpoint nests the event under `header`, with the id at the
    // top level of that object rather than alongside `competitions`.
    try {
      return parseEvent({ ...header, id: header["id"] ?? providerEventId }, league);
    } catch {
      return null;
    }
  }
}
