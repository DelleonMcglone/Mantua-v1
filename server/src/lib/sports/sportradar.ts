/**
 * S-003 — the Sportradar adapter: the LICENSED primary provider behind the
 * `SportsDataProvider` boundary (D-102).
 *
 * Sportradar's NFL API v7 is a commercial, documented, SLA-backed feed —
 * the replacement for prototyping against ESPN's undocumented backend
 * (`espn.ts`, which remains the fallback and the WNBA source). Endpoint
 * paths and response shapes below are pinned against the official docs;
 * every mapping cites the reference page it was read from. Where a field
 * could not be verified from the docs the mapping is marked TODO-verify
 * rather than guessed (spec §3.5: absence of data never settles a market).
 *
 * Docs (developer.sportradar.com, fetched 2026-09-06):
 *  - Overview:        https://developer.sportradar.com/football/reference/nfl-overview
 *  - Auth:            https://developer.sportradar.com/getting-started/docs/authentication
 *                     (header `x-api-key`; host `https://api.sportradar.com`,
 *                     NFL prefix `/nfl/official/{access_level}/v7/{lang}`)
 *  - Trial limits:    https://developer.sportradar.com/getting-started/docs/your-account
 *                     (trial keys: 1 QPS, 1,000 requests per rolling 30 days)
 *  - Current season:  https://developer.sportradar.com/football/reference/nfl-current-season-schedule
 *  - Current week:    https://developer.sportradar.com/football/reference/nfl-current-week-schedule
 *  - Boxscore:        https://developer.sportradar.com/football/reference/nfl-game-boxscore
 *  - Play-by-play:    https://developer.sportradar.com/football/reference/nfl-play-by-play
 *                     (consumed since task 041: `game_plays` ingestion. Shape
 *                     re-verified 2026-09-06: root `periods[]`, each period
 *                     `{number, sequence, pbp[]}`; `pbp` holds drive objects
 *                     whose `events[]` carry the plays; a play is
 *                     `{type:"play", id, sequence, clock, play_type,
 *                     description, home_points, away_points, scoring_play,
 *                     wall_clock, start_situation{possession{alias,…}},
 *                     end_situation{possession{alias,…}}}`. `sequence` is an
 *                     epoch-milliseconds-scale ordering number — "use this
 *                     value to help sequence play-by-play events".)
 *  - Standings:       https://developer.sportradar.com/football/reference/nfl-postgame-standings
 *                     (fetched 2026-09-06: path `/seasons/{year}/{type}/
 *                     standings/season.json`; root `{season{year,type},
 *                     conferences[]}`; conferences[].divisions[].teams[] each
 *                     `{id, name, market, alias, wins, losses, ties, win_pct,
 *                     points_for, points_against, rank{division, conference},
 *                     streak{type, length, desc}, records[]{category, wins,
 *                     losses, ties, win_pct, …}}` — categories include
 *                     `home` and `road`.)
 *  - Hierarchy:       https://developer.sportradar.com/football/reference/nfl-league-hierarchy
 *  - Team roster:     https://developer.sportradar.com/football/reference/nfl-team-roster
 *  - Player profile:  https://developer.sportradar.com/football/reference/nfl-player-profile
 *  - Weekly injuries: https://developer.sportradar.com/football/reference/nfl-weekly-injuries
 *
 * Trial-quota posture: 1 QPS and 1,000 calls/30 days means the adapter must
 * be POLITE by construction — requests are serialized with a minimum spacing,
 * a 429 opens a cooldown honoring `Retry-After`, and per-feed TTLs are far
 * longer than ESPN's (a trial key polling the boxscore at 10s would burn the
 * whole month in three hours). Production keys relax the TTLs, not the
 * pacing.
 */

import {
  type LeagueSlug,
  type ProviderEvent,
  type ProviderEventStatus,
  type ProviderFeed,
  type ProviderInjuryReport,
  type ProviderInjuryStatus,
  type ProviderPlay,
  type ProviderPlayer,
  type ProviderTeamStanding,
  type ProviderSlate,
  type ProviderTeam,
  type SportsDataProvider,
  ProviderShapeError,
  teamKey,
  type SeasonType,
} from "./provider.ts";
import { ResilientJson } from "./resilience.ts";

const HOST = "https://api.sportradar.com";

/** Minimum spacing between upstream requests. Trial is hard-capped at 1 QPS
 *  (docs: getting-started/docs/your-account), so 1.1s keeps a margin; the
 *  production floor stays polite without throttling live reads. */
const MIN_INTERVAL_MS: Record<"trial" | "production", number> = {
  trial: 1_100,
  production: 250,
};

/** Cooldown after a 429 when the response carries no Retry-After. */
const DEFAULT_429_COOLDOWN_MS = 5_000;

/**
 * Per-feed TTLs, trial vs production. Chosen against the upstream cache TTLs
 * the docs publish (boxscore: 3s in-progress / 60s scheduled; hierarchy: 4h;
 * player profile: 15m) and the trial quota of ~33 requests/day.
 */
export const SPORTRADAR_TTLS: Record<
  "trial" | "production",
  {
    schedule: number;
    event: number;
    hierarchy: number;
    roster: number;
    injuries: number;
    pbp: number;
    standings: number;
  }
> = {
  trial: {
    schedule: 30 * 60_000,
    event: 5 * 60_000,
    hierarchy: 24 * 3_600_000,
    roster: 24 * 3_600_000,
    injuries: 6 * 3_600_000,
    // Pbp is only fetched for live/just-finished games on a bounded per-tick
    // rotation (task 041); the TTL stops one tick double-fetching a game.
    pbp: 5 * 60_000,
    standings: 6 * 3_600_000,
  },
  production: {
    schedule: 60_000,
    event: 10_000,
    hierarchy: 4 * 3_600_000,
    roster: 3_600_000,
    injuries: 15 * 60_000,
    pbp: 15_000,
    standings: 3_600_000,
  },
};

// ─── Status mapping ─────────────────────────────────────────────────────────

/**
 * Game statuses per the boxscore reference
 * (football/reference/nfl-game-boxscore): scheduled, created, inprogress,
 * complete, closed, cancelled, delayed, suspended, postponed, time-tbd,
 * if necessary, unnecessary.
 *
 * Two deliberate choices:
 *  - `complete` maps to `in_progress`, NOT `final`. Sportradar distinguishes
 *    "the game just ended" (complete) from "the score is confirmed" (closed);
 *    only the confirmed state may settle a market (spec §3.5), and mapping
 *    complete → final would let an unconfirmed score resolve on-chain.
 *  - `unnecessary` (a playoff slot that will not be played) maps to
 *    `cancelled` — the void path — while `if necessary` (a placeholder that
 *    may yet be played) maps to `unknown`, because neither "will happen" nor
 *    "won't happen" is knowable yet.
 */
const STATUS_MAP: Partial<Record<string, ProviderEventStatus>> = {
  scheduled: "scheduled",
  created: "scheduled",
  "time-tbd": "scheduled",
  delayed: "scheduled",
  inprogress: "in_progress",
  halftime: "in_progress",
  complete: "in_progress",
  closed: "final",
  cancelled: "cancelled",
  canceled: "cancelled",
  postponed: "postponed",
  suspended: "postponed",
  unnecessary: "cancelled",
  "if necessary": "unknown",
  if_necessary: "unknown",
};

export function mapSportradarStatus(raw: unknown): ProviderEventStatus {
  if (typeof raw !== "string") return "unknown";
  return STATUS_MAP[raw.toLowerCase()] ?? "unknown";
}

/**
 * Roster status → `players.status`. The roster reference
 * (football/reference/nfl-team-roster) enumerates: ACT, DUP, EXE, FRES, IR,
 * IRD, NON, NWT, PRA, PRA_IR, PUP, RET, SUS, UDF, UFA. Only ACT is active
 * and only RET is retired; everything else — including codes the docs list
 * without prose definitions (DUP, FRES, IRD, NWT — TODO-verify their exact
 * meanings against Sportradar's FAQ) — is conservatively `inactive`.
 */
export function mapRosterStatus(raw: unknown): "active" | "inactive" | "retired" {
  if (typeof raw !== "string") return "inactive";
  const s = raw.toUpperCase();
  if (s === "ACT") return "active";
  if (s === "RET") return "retired";
  return "inactive";
}

/**
 * Injury designation → `injuries.status`. The weekly-injuries reference
 * (football/reference/nfl-weekly-injuries) documents "Out", "Doubtful" and
 * "Questionable"; "Probable" was retired by the NFL in 2016 but is mapped in
 * case historical seasons carry it. Anything else returns null and the
 * report is SKIPPED, never guessed into a status the odds engine would act
 * on. (IR/day-to-day arrive via roster status codes, not this feed —
 * TODO-verify whether any current payload emits them here.)
 */
export function mapInjuryStatus(raw: unknown): ProviderInjuryStatus | null {
  if (typeof raw !== "string") return null;
  switch (raw.trim().toLowerCase()) {
    case "out":
      return "out";
    case "doubtful":
      return "doubtful";
    case "questionable":
      return "questionable";
    case "probable":
      return "probable";
    default:
      return null;
  }
}

// ─── Shape helpers (same defensive posture as espn.ts) ──────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

// ─── Parsers (exported for fixture tests) ───────────────────────────────────

/**
 * One schedule/boxscore team object → `ProviderTeam`.
 *
 * Fields per the current-season-schedule and boxscore references: `id`
 * (UUID), `name` ("Las Vegas Raiders" in schedule games; hierarchy teams
 * split `market` + `name`), `alias` ("LV"). The alias doubles as the
 * abbreviation, which is what the provider-agnostic `teamKey` hashes — the
 * property that lets Sportradar rows corroborate ESPN rows (B3-004).
 */
export function parseSportradarTeam(raw: unknown, league: LeagueSlug): ProviderTeam {
  const rec = asRecord(raw);
  if (!rec) throw new ProviderShapeError("team is not an object");
  const providerId = asString(rec["id"]);
  const alias = asString(rec["alias"]);
  if (!providerId || !alias) throw new ProviderShapeError("team missing id or alias");

  // Hierarchy teams carry `market` ("Denver") + `name` ("Broncos"); schedule
  // teams carry the full `name` ("Denver Broncos"). Compose when both exist.
  const market = asString(rec["market"]);
  const name = asString(rec["name"]) ?? alias;
  const displayName = market && !name.startsWith(market) ? `${market} ${name}` : name;

  return {
    providerId,
    key: teamKey(league, alias),
    name: displayName,
    abbreviation: alias,
    // Sportradar team marks are a separate licensed Images API, not part of
    // NFL v7 — no logo URL here by design (the UI falls back gracefully).
  };
}

/**
 * One game object from the schedule or boxscore feeds → `ProviderEvent`.
 *
 * Schedule game fields (nfl-current-season-schedule): `id`, `status`,
 * `scheduled` (ISO datetime), `home`/`away` (id/name/alias), `scoring`
 * with `home_points`/`away_points`. Boxscore (nfl-game-boxscore) carries
 * the same identity fields with `points` directly on `home`/`away`.
 */
export function parseSportradarGame(
  raw: unknown,
  league: LeagueSlug,
  seasonType: SeasonType | null = null,
): ProviderEvent {
  const game = asRecord(raw);
  if (!game) throw new ProviderShapeError("game is not an object");

  const providerEventId = asString(game["id"]);
  if (!providerEventId) throw new ProviderShapeError("game has no id");

  const scheduled = asString(game["scheduled"]);
  const startsMs = scheduled ? Date.parse(scheduled) : Number.NaN;
  if (!Number.isFinite(startsMs)) throw new ProviderShapeError("game has no parseable scheduled");

  const homeRec = asRecord(game["home"]);
  const awayRec = asRecord(game["away"]);
  if (!homeRec || !awayRec) throw new ProviderShapeError("game missing home or away");

  // Scores: boxscore puts `points` on the team objects; schedule nests them
  // in `scoring.home_points` / `scoring.away_points`.
  const scoring = asRecord(game["scoring"]);
  const homeScore = asNumber(homeRec["points"]) ?? asNumber(scoring?.["home_points"]);
  const awayScore = asNumber(awayRec["points"]) ?? asNumber(scoring?.["away_points"]);

  return {
    providerEventId,
    league,
    startsAt: Math.floor(startsMs / 1000),
    status: mapSportradarStatus(game["status"]),
    home: parseSportradarTeam(homeRec, league),
    away: parseSportradarTeam(awayRec, league),
    ...(homeScore !== undefined ? { homeScore } : {}),
    ...(awayScore !== undefined ? { awayScore } : {}),
    ...(seasonType !== null ? { seasonType } : {}),
    // No homeWinProbabilityBps: pre-game odds are Sportradar's separate Odds
    // Comparison API, not NFL v7 — pools seed at 50/50 until a line source
    // is licensed (provider.ts documents the fallback).
  };
}

/**
 * A current-week/current-season schedule payload → events.
 *
 * Shape (nfl-current-week-schedule): root `{ id, year, type, name, weeks[] }`,
 * each week `{ id, sequence, title, games[] }`. One malformed game is
 * skipped, not fatal — same slate-survival rule as ESPN's parser.
 */
export function parseSportradarSchedule(payload: unknown, league: LeagueSlug): ProviderEvent[] {
  const root = asRecord(payload);
  const weeks = root?.["weeks"];
  if (!Array.isArray(weeks)) throw new ProviderShapeError("payload has no weeks array");
  // The schedule root names the season phase (PRE | REG | PST) once for every
  // game it carries — that is the D-105 season switch's source of truth.
  const seasonType = mapSeasonType(root?.["type"]);

  const out: ProviderEvent[] = [];
  for (const weekRaw of weeks) {
    const games = asRecord(weekRaw)?.["games"];
    if (!Array.isArray(games)) continue;
    for (const raw of games) {
      try {
        out.push(parseSportradarGame(raw, league, seasonType));
      } catch {
        // Skip the one bad game; keep the slate.
      }
    }
  }
  return out;
}

/** Season pointer parsed off a schedule payload, for the injuries path. */
export interface SeasonPointer {
  year: number;
  /** PRE | REG | PST per the schedule reference. */
  type: string;
  week: number;
}

export function parseSeasonPointer(payload: unknown): SeasonPointer | null {
  const root = asRecord(payload);
  const year = asNumber(root?.["year"]);
  const type = asString(root?.["type"]);
  const weeks = root?.["weeks"];
  const firstWeek = Array.isArray(weeks) ? asRecord(weeks[0]) : null;
  const week = asNumber(firstWeek?.["sequence"]);
  if (year === undefined || !type || week === undefined) return null;
  return { year, type, week };
}

/**
 * League hierarchy payload → teams.
 *
 * Shape (nfl-league-hierarchy): `conferences[].divisions[].teams[]`, team
 * fields `id`, `name`, `market`, `alias` (plus franchise/venue we ignore).
 */
export function parseSportradarHierarchy(payload: unknown, league: LeagueSlug): ProviderTeam[] {
  const root = asRecord(payload);
  const conferences = root?.["conferences"];
  if (!Array.isArray(conferences)) throw new ProviderShapeError("payload has no conferences");

  const out: ProviderTeam[] = [];
  for (const confRaw of conferences) {
    const divisions = asRecord(confRaw)?.["divisions"];
    if (!Array.isArray(divisions)) continue;
    for (const divRaw of divisions) {
      const teams = asRecord(divRaw)?.["teams"];
      if (!Array.isArray(teams)) continue;
      for (const raw of teams) {
        try {
          out.push(parseSportradarTeam(raw, league));
        } catch {
          // Skip the one bad team; keep the hierarchy.
        }
      }
    }
  }
  return out;
}

/**
 * Full-roster payload → players.
 *
 * Shape (nfl-team-roster): root team `{ id, name, market, alias, players[] }`,
 * player fields `id`, `name`, `position`, `jersey`, `status`.
 */
export function parseSportradarRoster(payload: unknown, league: LeagueSlug): ProviderPlayer[] {
  const root = asRecord(payload);
  if (!root) throw new ProviderShapeError("roster payload is not an object");
  const alias = asString(root["alias"]);
  if (!alias) throw new ProviderShapeError("roster payload has no team alias");
  const players = root["players"];
  if (!Array.isArray(players)) throw new ProviderShapeError("roster payload has no players");

  const key = teamKey(league, alias);
  const out: ProviderPlayer[] = [];
  for (const raw of players) {
    const rec = asRecord(raw);
    const providerPlayerId = asString(rec?.["id"]);
    const name = asString(rec?.["name"]);
    if (!rec || !providerPlayerId || !name) continue; // skip, never guess
    const position = asString(rec["position"]);
    const jersey = asNumber(rec["jersey"]);
    out.push({
      providerPlayerId,
      name,
      teamKey: key,
      ...(position ? { position } : {}),
      ...(jersey !== undefined ? { jerseyNumber: jersey } : {}),
      status: mapRosterStatus(rec["status"]),
    });
  }
  return out;
}

/**
 * Weekly-injuries payload → reports.
 *
 * Shape (nfl-weekly-injuries): `teams[] → players[] → injuries[]`; player
 * `{ id, name, jersey, position }`; injury `{ status, status_date, primary,
 * secondary?, practice{status} }`. A player can carry several injury rows —
 * the latest by `status_date` wins (TODO-verify: the docs do not state an
 * ordering guarantee, so we sort rather than trust array position).
 */
export function parseSportradarInjuries(
  payload: unknown,
  league: LeagueSlug,
): ProviderInjuryReport[] {
  const root = asRecord(payload);
  const teams = root?.["teams"];
  if (!Array.isArray(teams)) throw new ProviderShapeError("payload has no teams array");

  const out: ProviderInjuryReport[] = [];
  for (const teamRaw of teams) {
    const teamRec = asRecord(teamRaw);
    const alias = asString(teamRec?.["alias"]);
    const key = alias ? teamKey(league, alias) : undefined;
    const players = teamRec?.["players"];
    if (!Array.isArray(players)) continue;

    for (const playerRaw of players) {
      const playerRec = asRecord(playerRaw);
      const providerPlayerId = asString(playerRec?.["id"]);
      const playerName = asString(playerRec?.["name"]);
      const injuries = playerRec?.["injuries"];
      if (!playerRec || !providerPlayerId || !playerName || !Array.isArray(injuries)) continue;

      // Pick the most recent report for the player (see docstring).
      let best: { status: ProviderInjuryStatus; desc?: string; atMs: number } | null = null;
      for (const injRaw of injuries) {
        const injRec = asRecord(injRaw);
        if (!injRec) continue;
        const status = mapInjuryStatus(injRec["status"]);
        if (!status) continue; // unrecognised designation — skip, never guess
        const atStr = asString(injRec["status_date"]);
        const atMs = atStr ? Date.parse(atStr) : 0;
        const desc = asString(injRec["primary"]);
        if (!best || (Number.isFinite(atMs) && atMs > best.atMs)) {
          best = { status, atMs: Number.isFinite(atMs) ? atMs : 0, ...(desc ? { desc } : {}) };
        }
      }
      if (!best) continue;
      out.push({
        providerPlayerId,
        playerName,
        ...(key ? { teamKey: key } : {}),
        status: best.status,
        ...(best.desc ? { description: best.desc } : {}),
        ...(best.atMs > 0 ? { providerUpdatedAt: Math.floor(best.atMs / 1000) } : {}),
      });
    }
  }
  return out;
}

/**
 * Play-by-play payload → plays (task 041).
 *
 * Shape (nfl-play-by-play, header citation): root `periods[]`, each period
 * `{number, sequence, pbp[]}`; `pbp` entries are drive objects carrying an
 * `events[]` array, and (defensively) a `pbp` entry that is itself an event
 * object of `type: "play"` is accepted too. Only entries whose `type` is
 * `"play"` with a numeric `sequence` become rows — anything else (comments,
 * timeouts typed differently, malformed entries) is skipped, never guessed.
 *
 * `sequence` is the provider's ordering number (epoch-ms scale — see the
 * header); possession comes from `start_situation.possession.alias` (the
 * offense running the play), and `end_situation.possession.alias` rides the
 * detail jsonb as `possessionAfter` for live-state derivation.
 */
export function parseSportradarPlays(payload: unknown, league: LeagueSlug): ProviderPlay[] {
  const root = asRecord(payload);
  const periods = root?.["periods"];
  if (!Array.isArray(periods)) throw new ProviderShapeError("payload has no periods array");

  const out: ProviderPlay[] = [];
  for (const periodRaw of periods) {
    const periodRec = asRecord(periodRaw);
    const periodNumber = asNumber(periodRec?.["number"]) ?? asNumber(periodRec?.["sequence"]);
    const pbp = periodRec?.["pbp"];
    if (!Array.isArray(pbp)) continue;

    const eventObjects: Record<string, unknown>[] = [];
    for (const entryRaw of pbp) {
      const entry = asRecord(entryRaw);
      if (!entry) continue;
      const driveEvents = entry["events"];
      if (Array.isArray(driveEvents)) {
        for (const evRaw of driveEvents) {
          const ev = asRecord(evRaw);
          if (ev) eventObjects.push(ev);
        }
      } else if (entry["type"] === "play") {
        eventObjects.push(entry);
      }
    }

    for (const ev of eventObjects) {
      if (ev["type"] !== "play") continue;
      const sequence = asNumber(ev["sequence"]);
      if (sequence === undefined) continue; // no cursor — skip, never guess
      const clock = asString(ev["clock"]);
      const playType = asString(ev["play_type"]);
      const description = asString(ev["description"]);
      const homeScore = asNumber(ev["home_points"]);
      const awayScore = asNumber(ev["away_points"]);
      const scoringPlay = ev["scoring_play"] === true;

      const startPossession = asRecord(asRecord(ev["start_situation"])?.["possession"]);
      const endPossession = asRecord(asRecord(ev["end_situation"])?.["possession"]);
      const startAlias = asString(startPossession?.["alias"]);
      const endAlias = asString(endPossession?.["alias"]);
      const wallClock = asString(ev["wall_clock"]);

      const detail: Record<string, unknown> = {
        ...(endAlias ? { possessionAfter: teamKey(league, endAlias) } : {}),
        ...(wallClock ? { wallClock } : {}),
      };

      out.push({
        sequence,
        ...(periodNumber !== undefined ? { period: periodNumber } : {}),
        ...(clock ? { clock } : {}),
        ...(playType ? { playType } : {}),
        ...(description ? { description } : {}),
        ...(startAlias ? { teamKey: teamKey(league, startAlias) } : {}),
        scoringPlay,
        ...(homeScore !== undefined ? { homeScore } : {}),
        ...(awayScore !== undefined ? { awayScore } : {}),
        ...(Object.keys(detail).length > 0 ? { detail } : {}),
      });
    }
  }
  return out;
}

/** Season type per the schedule/standings references: PRE | REG | PST. */
export function mapSeasonType(raw: unknown): SeasonType | null {
  if (typeof raw !== "string") return null;
  switch (raw.toUpperCase()) {
    case "REG":
      return "regular";
    case "PRE":
      return "preseason";
    case "PST":
      return "postseason";
    default:
      return null; // unrecognised season type — skip the feed, never guess
  }
}

/** "5-2" / "5-2-1" from documented numeric wins/losses/ties. */
function recordString(wins: number, losses: number, ties: number): string {
  return ties > 0 ? `${String(wins)}-${String(losses)}-${String(ties)}` : `${String(wins)}-${String(losses)}`;
}

/**
 * Postgame-standings payload → standings lines (task 041).
 *
 * Shape (nfl-postgame-standings, header citation): root `{season{year,type},
 * conferences[]}`; `conferences[].divisions[].teams[]` with `wins/losses/
 * ties/win_pct/points_for/points_against`, `rank{division, conference}`,
 * `streak{type, length, desc}`, and a `records[]` array of categorised
 * splits (`home`, `road`, `division`, `conference`, …).
 *
 * The typed columns take the documented top-level fields; every categorised
 * split plus `win_pct` lands as a flat numeric map in `stats` (the S-007
 * aggregate jsonb, read by `teamSeasonStats`).
 */
export function parseSportradarStandings(
  payload: unknown,
  league: LeagueSlug,
): ProviderTeamStanding[] {
  const root = asRecord(payload);
  const seasonRec = asRecord(root?.["season"]);
  const year = asNumber(seasonRec?.["year"]);
  const seasonType = mapSeasonType(seasonRec?.["type"]);
  const conferences = root?.["conferences"];
  if (year === undefined || seasonType === null || !Array.isArray(conferences)) {
    throw new ProviderShapeError("standings payload has no season/conferences");
  }

  const out: ProviderTeamStanding[] = [];
  for (const confRaw of conferences) {
    const divisions = asRecord(confRaw)?.["divisions"];
    if (!Array.isArray(divisions)) continue;
    for (const divRaw of divisions) {
      const teams = asRecord(divRaw)?.["teams"];
      if (!Array.isArray(teams)) continue;
      for (const teamRaw of teams) {
        const rec = asRecord(teamRaw);
        const providerTeamId = asString(rec?.["id"]);
        const alias = asString(rec?.["alias"]);
        const wins = asNumber(rec?.["wins"]);
        const losses = asNumber(rec?.["losses"]);
        if (!rec || !providerTeamId || !alias || wins === undefined || losses === undefined) {
          continue; // skip the one bad team; keep the table
        }
        const ties = asNumber(rec["ties"]) ?? 0;
        const winPct = asNumber(rec["win_pct"]);
        const pointsFor = asNumber(rec["points_for"]);
        const pointsAgainst = asNumber(rec["points_against"]);

        const rank = asRecord(rec["rank"]);
        const divisionRank = asNumber(rank?.["division"]);
        const conferenceRank = asNumber(rank?.["conference"]);

        // Streak: compose from the documented numeric fields; `desc` is used
        // only when it already matches the "W3" notation the column models.
        const streakRec = asRecord(rec["streak"]);
        const streakDesc = asString(streakRec?.["desc"]);
        const streakType = asString(streakRec?.["type"]);
        const streakLength = asNumber(streakRec?.["length"]);
        let streak: string | undefined;
        if (streakDesc && /^[WLT]\d{1,3}$/.test(streakDesc)) streak = streakDesc;
        else if (streakType && streakLength !== undefined) {
          const letter = { win: "W", loss: "L", tie: "T" }[streakType.toLowerCase()];
          if (letter) streak = `${letter}${String(streakLength)}`;
        }

        // Categorised splits → home/away record strings + flat stats map.
        const stats: Record<string, number> = {
          ...(winPct !== undefined ? { win_pct: winPct } : {}),
        };
        let homeRecord: string | undefined;
        let awayRecord: string | undefined;
        const records = rec["records"];
        if (Array.isArray(records)) {
          for (const splitRaw of records) {
            const split = asRecord(splitRaw);
            const category = asString(split?.["category"]);
            if (!split || !category || !/^[a-z_]{1,24}$/.test(category)) continue;
            const w = asNumber(split["wins"]);
            const l = asNumber(split["losses"]);
            const t = asNumber(split["ties"]) ?? 0;
            if (w !== undefined) stats[`${category}_wins`] = w;
            if (l !== undefined) stats[`${category}_losses`] = l;
            if (t > 0 || asNumber(split["ties"]) !== undefined) stats[`${category}_ties`] = t;
            const p = asNumber(split["win_pct"]);
            if (p !== undefined) stats[`${category}_win_pct`] = p;
            if (w !== undefined && l !== undefined) {
              // Sportradar's away split is documented as category "road".
              if (category === "home") homeRecord = recordString(w, l, t);
              if (category === "road") awayRecord = recordString(w, l, t);
            }
          }
        }

        out.push({
          providerTeamId,
          teamKey: teamKey(league, alias),
          season: String(year),
          seasonType,
          wins,
          losses,
          ties,
          ...(divisionRank !== undefined ? { divisionRank } : {}),
          ...(conferenceRank !== undefined ? { conferenceRank } : {}),
          ...(pointsFor !== undefined ? { pointsFor } : {}),
          ...(pointsAgainst !== undefined ? { pointsAgainst } : {}),
          ...(streak ? { streak } : {}),
          ...(homeRecord ? { homeRecord } : {}),
          ...(awayRecord ? { awayRecord } : {}),
          stats,
        });
      }
    }
  }
  return out;
}

// ─── Polite transport ───────────────────────────────────────────────────────

/**
 * Wrap a fetch with the trial-quota manners: requests are serialized with a
 * minimum spacing, the `x-api-key` header is injected (auth doc:
 * getting-started/docs/authentication), and a 429 opens a cooldown honoring
 * `Retry-After` before the next attempt. The wrapper composes with
 * `ResilientJson`, which supplies retry/backoff, TTL caching, stale-grace
 * serving and the circuit breaker on top.
 */
export function politeFetch(
  apiKey: string,
  minIntervalMs: number,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): typeof fetch {
  let gate = Promise.resolve();
  let notBefore = 0;

  return async (input, init) => {
    // Serialize: each caller waits for the previous request's turn, then
    // claims the next slot. Failures never wedge the gate.
    const turn = gate.then(async () => {
      const wait = notBefore - now();
      if (wait > 0) await sleep(wait);
      notBefore = now() + minIntervalMs;
    });
    gate = turn.catch(() => undefined);
    await turn;

    const headers = new Headers(init?.headers);
    headers.set("x-api-key", apiKey);
    const res = await fetchImpl(input, { ...init, headers });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const coolMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_429_COOLDOWN_MS;
      notBefore = Math.max(notBefore, now() + coolMs);
    }
    return res;
  };
}

// ─── The adapter ────────────────────────────────────────────────────────────

export interface SportradarOptions {
  apiKey: string;
  /** Access-level path segment; also selects the TTL profile. */
  accessLevel: "trial" | "production";
  fetchImpl?: typeof fetch;
}

export class SportradarProvider implements SportsDataProvider {
  readonly name = "sportradar";
  /** NFL API v7 only — WNBA stays on the ESPN adapter until a WNBA package
   *  is licensed (DM-105 covers both; the licence does not, yet). */
  readonly leagues = ["nfl"] as const;

  private readonly http: ResilientJson;
  private readonly prefix: string;
  private readonly ttl: (typeof SPORTRADAR_TTLS)["trial"];

  constructor(opts: SportradarOptions) {
    // Path pattern per every NFL v7 reference page:
    //   https://api.sportradar.com/nfl/official/{access_level}/v7/{lang}/…
    // ("official" is Sportradar's historical package name for this product,
    // not a claim about league data rights — see D-102.)
    this.prefix = `/nfl/official/${opts.accessLevel}/v7/en`;
    this.ttl = SPORTRADAR_TTLS[opts.accessLevel];
    this.http = new ResilientJson(
      [HOST],
      politeFetch(opts.apiKey, MIN_INTERVAL_MS[opts.accessLevel], opts.fetchImpl),
    );
  }

  breakerState(): Record<string, { failures: number; open: boolean }> {
    return this.http.breakerState();
  }

  private assertLeague(league: LeagueSlug): void {
    if (league !== "nfl") {
      throw new ProviderShapeError(`sportradar adapter does not cover ${league}`);
    }
  }

  /** Current-week schedule — the NFL's natural "slate" unit.
   *  Path: /games/current_week/schedule.json (nfl-current-week-schedule). */
  async getSlate(league: LeagueSlug): Promise<ProviderSlate> {
    this.assertLeague(league);
    const res = await this.http.get<unknown>(
      `sportradar:slate:${league}`,
      `${this.prefix}/games/current_week/schedule.json`,
      this.ttl.schedule,
    );
    return {
      provider: this.name,
      league,
      events: parseSportradarSchedule(res.value, league),
      delayed: res.delayed,
      fetchedAt: res.fetchedAt,
    };
  }

  /** Boxscore for one game — live score polling and final capture.
   *  Path: /games/{game_id}/boxscore.json (nfl-game-boxscore). */
  async getEvent(league: LeagueSlug, providerEventId: string): Promise<ProviderEvent | null> {
    this.assertLeague(league);
    const res = await this.http.get<unknown>(
      `sportradar:event:${league}:${providerEventId}`,
      `${this.prefix}/games/${encodeURIComponent(providerEventId)}/boxscore.json`,
      this.ttl.event,
    );
    try {
      return parseSportradarGame(res.value, league);
    } catch {
      return null;
    }
  }

  /** League hierarchy → all 32 teams.
   *  Path: /league/hierarchy.json (nfl-league-hierarchy). */
  async getTeams(league: LeagueSlug): Promise<ProviderFeed<ProviderTeam>> {
    this.assertLeague(league);
    const res = await this.http.get<unknown>(
      `sportradar:hierarchy:${league}`,
      `${this.prefix}/league/hierarchy.json`,
      this.ttl.hierarchy,
    );
    return {
      provider: this.name,
      league,
      items: parseSportradarHierarchy(res.value, league),
      delayed: res.delayed,
      fetchedAt: res.fetchedAt,
    };
  }

  /** Full roster for one team.
   *  Path: /teams/{team_id}/full_roster.json (nfl-team-roster). */
  async getRoster(
    league: LeagueSlug,
    providerTeamId: string,
  ): Promise<ProviderFeed<ProviderPlayer>> {
    this.assertLeague(league);
    const res = await this.http.get<unknown>(
      `sportradar:roster:${league}:${providerTeamId}`,
      `${this.prefix}/teams/${encodeURIComponent(providerTeamId)}/full_roster.json`,
      this.ttl.roster,
    );
    return {
      provider: this.name,
      league,
      items: parseSportradarRoster(res.value, league),
      delayed: res.delayed,
      fetchedAt: res.fetchedAt,
    };
  }

  /** Weekly injuries for the current season week. Two-step: the current-week
   *  schedule names {year}/{type}/{week}, then
   *  /seasons/{year}/{type}/{week}/injuries.json (nfl-weekly-injuries). */
  async getInjuries(league: LeagueSlug): Promise<ProviderFeed<ProviderInjuryReport>> {
    this.assertLeague(league);
    const sched = await this.http.get<unknown>(
      `sportradar:slate:${league}`,
      `${this.prefix}/games/current_week/schedule.json`,
      this.ttl.schedule,
    );
    const pointer = parseSeasonPointer(sched.value);
    if (!pointer) throw new ProviderShapeError("schedule payload names no season/week");

    const res = await this.http.get<unknown>(
      `sportradar:injuries:${league}:${String(pointer.year)}:${pointer.type}:${String(pointer.week)}`,
      `${this.prefix}/seasons/${String(pointer.year)}/${pointer.type}/${String(pointer.week)}/injuries.json`,
      this.ttl.injuries,
    );
    return {
      provider: this.name,
      league,
      items: parseSportradarInjuries(res.value, league),
      delayed: sched.delayed || res.delayed,
      fetchedAt: res.fetchedAt,
    };
  }

  /** Play-by-play for one game (task 041).
   *  Path: /games/{game_id}/pbp.json (nfl-play-by-play). Quota rule: called
   *  only by the ingest worker's bounded live/just-finished rotation. */
  async getPlayByPlay(
    league: LeagueSlug,
    providerEventId: string,
  ): Promise<ProviderFeed<ProviderPlay>> {
    this.assertLeague(league);
    const res = await this.http.get<unknown>(
      `sportradar:pbp:${league}:${providerEventId}`,
      `${this.prefix}/games/${encodeURIComponent(providerEventId)}/pbp.json`,
      this.ttl.pbp,
    );
    return {
      provider: this.name,
      league,
      items: parseSportradarPlays(res.value, league),
      delayed: res.delayed,
      fetchedAt: res.fetchedAt,
    };
  }

  /** Season standings (task 041). Two-step like injuries: the current-week
   *  schedule names {year}/{type} (provider-cached, so usually free), then
   *  /seasons/{year}/{type}/standings/season.json (nfl-postgame-standings). */
  async getStandings(league: LeagueSlug): Promise<ProviderFeed<ProviderTeamStanding>> {
    this.assertLeague(league);
    const sched = await this.http.get<unknown>(
      `sportradar:slate:${league}`,
      `${this.prefix}/games/current_week/schedule.json`,
      this.ttl.schedule,
    );
    const pointer = parseSeasonPointer(sched.value);
    if (!pointer) throw new ProviderShapeError("schedule payload names no season");

    const res = await this.http.get<unknown>(
      `sportradar:standings:${league}:${String(pointer.year)}:${pointer.type}`,
      `${this.prefix}/seasons/${String(pointer.year)}/${pointer.type}/standings/season.json`,
      this.ttl.standings,
    );
    return {
      provider: this.name,
      league,
      items: parseSportradarStandings(res.value, league),
      delayed: sched.delayed || res.delayed,
      fetchedAt: res.fetchedAt,
    };
  }
}

// Availability/singleton wiring (which reads the env) lives in
// active-provider.ts, so this module — like espn.ts — stays importable in
// unit tests with no environment at all.
