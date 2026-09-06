/**
 * 039 — S-011..S-020: the agent's sports-data tool suite.
 *
 * Every function here answers from the CANONICAL Mantua database (the rows
 * the ingest workers maintain in `db/schema/markets.ts`) — never from a
 * provider per-request. The agent's sports knowledge is these tables.
 *
 * Two rules shape every result:
 *
 *  1. **Honesty.** Empty-because-no-data (ingestion pending) and
 *     empty-because-no-match are different answers and both are structured:
 *     `status: "unavailable"` with a reason like "not yet ingested" for the
 *     former, `status: "not_found"` for the latter. A field the schema does
 *     not store (live period/clock/possession, play-by-play, detailed stats)
 *     is reported absent with a reason — never invented. The provider wave
 *     that fills these lands in parallel (B3), so "unavailable" is a
 *     temporary truth, not an error.
 *
 *  2. **Never guess silently.** Team and player lookups fuzzy-match against
 *     canonical rows; an ambiguous query returns `status: "ambiguous"` with
 *     `didYouMean` candidates for the agent to relay, never a silent pick.
 *
 * The DB access runs through the narrow `SportsToolsDb` seam so the suite is
 * unit-testable without a live database (the repo's stub-env test rule):
 * `makeSportsToolsDb(db)` is the drizzle implementation; tests provide an
 * in-memory one over fixture rows.
 *
 * All tools are read-only — per 030's rule they write no audit rows (they
 * are deliberately absent from agent-chat's MUTATING_TOOL_ACTIONS map).
 */

import { z } from "zod";
import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import {
  events,
  gamePlays,
  injuries,
  leagues,
  marketFills,
  marketPrices,
  markets,
  players,
  teamRecords,
  teams,
} from "../../db/schema/index.ts";
import { playerSeasonStats, teamSeasonStats, type StatMap } from "./history.ts";
import { sanitizeProviderString } from "./public-slate.ts";

// ─── Row shapes (the columns this suite reads) ──────────────────────────────

export interface LeagueRow {
  id: string;
  slug: string;
  name: string;
}

export interface TeamRow {
  id: string;
  leagueId: string;
  key: string;
  name: string;
  shortName: string | null;
  abbreviation: string | null;
}

export interface PlayerRow {
  id: string;
  leagueId: string;
  teamId: string | null;
  name: string;
  position: string | null;
  jerseyNumber: number | null;
  status: string;
}

export interface OpenInjuryRow {
  id: string;
  playerId: string;
  teamId: string | null;
  status: string;
  description: string | null;
  reportedAt: Date;
  providerUpdatedAt: Date | null;
  playerName: string | null;
  position: string | null;
}

export interface EventRow {
  id: string;
  leagueId: string;
  providerEventId: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamKey: string | null;
  awayTeamKey: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  startsAt: Date;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface MarketRow {
  marketId: string;
  eventId: string;
  marketType: string;
  outcomeIndex: number;
  state: string;
  poolId: string | null;
  openingProbability: string | null;
}

export interface MarketPriceRow {
  impliedProbability: string;
  source: string;
  liquidityRaw: string | null;
  capturedAt: Date;
}

export interface MarketFillRow {
  direction: string;
  tokensRaw: string;
  usdcRaw: string;
  createdAt: Date;
}

/** One ingested play (task 041 — `game_plays`). */
export interface GamePlayRow {
  sequence: number;
  period: number | null;
  clock: string | null;
  playType: string | null;
  description: string | null;
  teamKey: string | null;
  scoringPlay: boolean;
  homeScore: number | null;
  awayScore: number | null;
  detail: unknown;
}

/** One standings snapshot line (task 041 — `team_records`). */
export interface TeamRecordRow {
  teamId: string;
  season: string;
  seasonType: string;
  wins: number;
  losses: number;
  ties: number;
  divisionRank: number | null;
  conferenceRank: number | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
  streak: string | null;
  homeRecord: string | null;
  awayRecord: string | null;
  stats: unknown;
  updatedAt: Date;
}

/**
 * The narrow read seam over the canonical DB. Each method is a thin, dumb
 * fetch — windowing, matching, aggregation, and the honesty envelope all
 * live in the tool functions so they are covered by unit tests.
 */
export interface SportsToolsDb {
  listLeagues(): Promise<LeagueRow[]>;
  listTeams(): Promise<TeamRow[]>;
  listPlayers(): Promise<PlayerRow[]>;
  /** Events where `team` is either side (id, key, or stored-name link), newest first. */
  listEventsForTeam(team: TeamRow, limit: number): Promise<EventRow[]>;
  listEventsForLeague(leagueId: string, limit: number): Promise<EventRow[]>;
  getEventByProviderEventId(providerEventId: string): Promise<EventRow | null>;
  hasAnyEvents(): Promise<boolean>;
  listOpenInjuriesForTeam(teamId: string): Promise<OpenInjuryRow[]>;
  listOpenInjuriesForPlayer(playerId: string): Promise<OpenInjuryRow[]>;
  hasAnyInjuries(): Promise<boolean>;
  listMarketsForEvent(eventId: string): Promise<MarketRow[]>;
  getMarket(marketId: string): Promise<MarketRow | null>;
  /** Price captures, newest first. */
  listMarketPrices(marketId: string, limit: number): Promise<MarketPriceRow[]>;
  listMarketFillsSince(marketId: string, since: Date): Promise<MarketFillRow[]>;
  // ── task 041: the 038 tables, now ingested ──
  /** Ingested plays for one game, newest first (desc sequence). */
  listPlaysForEvent(eventId: string, limit: number): Promise<GamePlayRow[]>;
  listTeamRecordsForTeam(teamId: string): Promise<TeamRecordRow[]>;
  listTeamRecordsForLeague(leagueId: string): Promise<TeamRecordRow[]>;
  /** The `players.season_stats` jsonb for one player (null when unset). */
  getPlayerSeasonStats(playerId: string): Promise<unknown>;
}

/** Production implementation over the drizzle client. */
export function makeSportsToolsDb(db: DB): SportsToolsDb {
  const eventCols = {
    id: events.id,
    leagueId: events.leagueId,
    providerEventId: events.providerEventId,
    homeTeam: events.homeTeam,
    awayTeam: events.awayTeam,
    homeTeamKey: events.homeTeamKey,
    awayTeamKey: events.awayTeamKey,
    homeTeamId: events.homeTeamId,
    awayTeamId: events.awayTeamId,
    startsAt: events.startsAt,
    status: events.status,
    homeScore: events.homeScore,
    awayScore: events.awayScore,
  };
  const injuryCols = {
    id: injuries.id,
    playerId: injuries.playerId,
    teamId: injuries.teamId,
    status: injuries.status,
    description: injuries.description,
    reportedAt: injuries.reportedAt,
    providerUpdatedAt: injuries.providerUpdatedAt,
    playerName: players.name,
    position: players.position,
  };
  const marketCols = {
    marketId: markets.marketId,
    eventId: markets.eventId,
    marketType: markets.marketType,
    outcomeIndex: markets.outcomeIndex,
    state: markets.state,
    poolId: markets.poolId,
    openingProbability: markets.openingProbability,
  };
  const teamRecordCols = {
    teamId: teamRecords.teamId,
    season: teamRecords.season,
    seasonType: teamRecords.seasonType,
    wins: teamRecords.wins,
    losses: teamRecords.losses,
    ties: teamRecords.ties,
    divisionRank: teamRecords.divisionRank,
    conferenceRank: teamRecords.conferenceRank,
    pointsFor: teamRecords.pointsFor,
    pointsAgainst: teamRecords.pointsAgainst,
    streak: teamRecords.streak,
    homeRecord: teamRecords.homeRecord,
    awayRecord: teamRecords.awayRecord,
    stats: teamRecords.stats,
    updatedAt: teamRecords.updatedAt,
  };
  return {
    async listLeagues() {
      return db.select({ id: leagues.id, slug: leagues.slug, name: leagues.name }).from(leagues);
    },
    async listTeams() {
      return db
        .select({
          id: teams.id,
          leagueId: teams.leagueId,
          key: teams.key,
          name: teams.name,
          shortName: teams.shortName,
          abbreviation: teams.abbreviation,
        })
        .from(teams)
        .limit(1000);
    },
    async listPlayers() {
      return db
        .select({
          id: players.id,
          leagueId: players.leagueId,
          teamId: players.teamId,
          name: players.name,
          position: players.position,
          jerseyNumber: players.jerseyNumber,
          status: players.status,
        })
        .from(players)
        .limit(5000);
    },
    async listEventsForTeam(team, limit) {
      return db
        .select(eventCols)
        .from(events)
        .where(
          or(
            eq(events.homeTeamId, team.id),
            eq(events.awayTeamId, team.id),
            eq(events.homeTeamKey, team.key),
            eq(events.awayTeamKey, team.key),
            eq(events.homeTeam, team.name),
            eq(events.awayTeam, team.name),
          ),
        )
        .orderBy(desc(events.startsAt))
        .limit(limit);
    },
    async listEventsForLeague(leagueId, limit) {
      return db
        .select(eventCols)
        .from(events)
        .where(eq(events.leagueId, leagueId))
        .orderBy(desc(events.startsAt))
        .limit(limit);
    },
    async getEventByProviderEventId(providerEventId) {
      const rows = await db
        .select(eventCols)
        .from(events)
        .where(eq(events.providerEventId, providerEventId))
        .limit(1);
      return rows.at(0) ?? null;
    },
    async hasAnyEvents() {
      const rows = await db.select({ id: events.id }).from(events).limit(1);
      return rows.length > 0;
    },
    async listOpenInjuriesForTeam(teamId) {
      return db
        .select(injuryCols)
        .from(injuries)
        .leftJoin(players, eq(injuries.playerId, players.id))
        .where(and(eq(injuries.teamId, teamId), isNull(injuries.resolvedAt)))
        .orderBy(desc(injuries.reportedAt));
    },
    async listOpenInjuriesForPlayer(playerId) {
      return db
        .select(injuryCols)
        .from(injuries)
        .leftJoin(players, eq(injuries.playerId, players.id))
        .where(and(eq(injuries.playerId, playerId), isNull(injuries.resolvedAt)))
        .orderBy(desc(injuries.reportedAt));
    },
    async hasAnyInjuries() {
      const rows = await db.select({ id: injuries.id }).from(injuries).limit(1);
      return rows.length > 0;
    },
    async listMarketsForEvent(eventId) {
      return db.select(marketCols).from(markets).where(eq(markets.eventId, eventId));
    },
    async getMarket(marketId) {
      const rows = await db
        .select(marketCols)
        .from(markets)
        .where(eq(markets.marketId, marketId))
        .limit(1);
      return rows.at(0) ?? null;
    },
    async listMarketPrices(marketId, limit) {
      return db
        .select({
          impliedProbability: marketPrices.impliedProbability,
          source: marketPrices.source,
          liquidityRaw: marketPrices.liquidityRaw,
          capturedAt: marketPrices.capturedAt,
        })
        .from(marketPrices)
        .where(eq(marketPrices.marketId, marketId))
        .orderBy(desc(marketPrices.capturedAt))
        .limit(limit);
    },
    async listMarketFillsSince(marketId, since) {
      return db
        .select({
          direction: marketFills.direction,
          tokensRaw: marketFills.tokensRaw,
          usdcRaw: marketFills.usdcRaw,
          createdAt: marketFills.createdAt,
        })
        .from(marketFills)
        .where(and(eq(marketFills.marketId, marketId), gte(marketFills.createdAt, since)))
        .orderBy(desc(marketFills.createdAt));
    },
    async listPlaysForEvent(eventId, limit) {
      return db
        .select({
          sequence: gamePlays.sequence,
          period: gamePlays.period,
          clock: gamePlays.clock,
          playType: gamePlays.playType,
          description: gamePlays.description,
          teamKey: gamePlays.teamKey,
          scoringPlay: gamePlays.scoringPlay,
          homeScore: gamePlays.homeScore,
          awayScore: gamePlays.awayScore,
          detail: gamePlays.detail,
        })
        .from(gamePlays)
        .where(eq(gamePlays.eventId, eventId))
        .orderBy(desc(gamePlays.sequence))
        .limit(limit);
    },
    async listTeamRecordsForTeam(teamId) {
      return db
        .select(teamRecordCols)
        .from(teamRecords)
        .where(eq(teamRecords.teamId, teamId))
        .orderBy(desc(teamRecords.season));
    },
    async listTeamRecordsForLeague(leagueId) {
      return db
        .select(teamRecordCols)
        .from(teamRecords)
        .innerJoin(teams, eq(teamRecords.teamId, teams.id))
        .where(eq(teams.leagueId, leagueId))
        .orderBy(desc(teamRecords.season));
    },
    async getPlayerSeasonStats(playerId) {
      const rows = await db
        .select({ seasonStats: players.seasonStats })
        .from(players)
        .where(eq(players.id, playerId))
        .limit(1);
      return rows.at(0)?.seasonStats ?? null;
    },
  };
}

// ─── Input validation ───────────────────────────────────────────────────────

const nameQuery = z.string().min(1).max(80);
const leagueQuery = z.string().min(1).max(32).optional();
const providerEventIdSchema = z
  .string()
  .regex(/^[\w-]{1,64}$/, "providerEventId must be a provider event id (alphanumeric)");
const marketIdSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "marketId must be the 0x-prefixed 66-char market id");

const getGameInput = z
  .object({
    team: nameQuery,
    league: leagueQuery,
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
      .optional(),
    windowDays: z.number().int().min(1).max(14).optional(),
  })
  .strict();

const gameRefInput = z
  .object({
    team: nameQuery.optional(),
    league: leagueQuery,
    providerEventId: providerEventIdSchema.optional(),
  })
  .strict();

const teamInput = z.object({ team: nameQuery, league: leagueQuery }).strict();

const playerStatsInput = z
  .object({
    player: nameQuery,
    team: nameQuery.optional(),
    league: leagueQuery,
    season: z.string().min(1).max(16).optional(),
  })
  .strict();

const injuryInput = z
  .object({
    player: nameQuery.optional(),
    team: nameQuery.optional(),
    league: leagueQuery,
  })
  .strict();

const recentGamesInput = z
  .object({
    team: nameQuery,
    league: leagueQuery,
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const headToHeadInput = z
  .object({
    teamA: nameQuery,
    teamB: nameQuery,
    league: leagueQuery,
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const standingsInput = z.object({ league: leagueQuery }).strict();

const marketIdInput = z.object({ marketId: marketIdSchema }).strict();

const marketHistoryInput = z
  .object({ marketId: marketIdSchema, limit: z.number().int().min(1).max(500).optional() })
  .strict();

const marketVolumeInput = z
  .object({ marketId: marketIdSchema, windowHours: z.number().int().min(1).max(720).optional() })
  .strict();

function parseInput<S extends z.ZodType>(schema: S, raw: unknown, tool: string): z.output<S> {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ");
    throw new Error(`${tool}: invalid input — ${detail}`);
  }
  return parsed.data;
}

// ─── Fuzzy resolution (teams, players, leagues) ─────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const clean = sanitizeProviderString;

/** Match score: 3 exact field, 2 whole-word hit in the name, 1 substring. */
function matchScore(query: string, fields: (string | null)[]): number {
  const q = normalize(query);
  if (q.length === 0) return 0;
  const normed = fields.filter((f): f is string => f !== null && f.length > 0).map(normalize);
  if (normed.some((f) => f === q)) return 3;
  for (const f of normed) {
    const words = f.split(" ");
    const qWords = q.split(" ");
    if (qWords.every((w) => words.includes(w))) return 2;
  }
  if (normed.some((f) => (q.length >= 3 && f.includes(q)) || (f.length >= 3 && q.includes(f)))) {
    return 1;
  }
  return 0;
}

type Resolution<T> =
  | { kind: "resolved"; row: T }
  | { kind: "ambiguous"; candidates: T[] }
  | { kind: "not_found"; suggestions: T[] }
  | { kind: "empty" };

function resolveByScore<T>(
  rows: T[],
  query: string,
  idOf: (row: T) => string,
  fieldsOf: (row: T) => (string | null)[],
): Resolution<T> {
  if (rows.length === 0) return { kind: "empty" };
  // Exact row-id lookups short-circuit (ids are unique); everything else —
  // including exact NAME hits, which can collide — goes through scoring so a
  // collision surfaces as ambiguous instead of a silent first-row pick.
  const idMatch = rows.find((r) => idOf(r) === query);
  if (idMatch) return { kind: "resolved", row: idMatch };
  let best = 0;
  const scored = rows.map((row) => {
    const score = matchScore(query, fieldsOf(row));
    if (score > best) best = score;
    return { row, score };
  });
  if (best === 0) {
    return { kind: "not_found", suggestions: rows.slice(0, 5) };
  }
  const winners = scored.filter((s) => s.score === best).map((s) => s.row);
  const first = winners.at(0);
  if (winners.length === 1 && first !== undefined) return { kind: "resolved", row: first };
  return { kind: "ambiguous", candidates: winners.slice(0, 5) };
}

interface Catalog {
  leagues: LeagueRow[];
  teams: TeamRow[];
}

async function loadCatalog(dbx: SportsToolsDb): Promise<Catalog> {
  const [leagueRows, teamRows] = await Promise.all([dbx.listLeagues(), dbx.listTeams()]);
  return { leagues: leagueRows, teams: teamRows };
}

function leagueSlugOf(catalog: Catalog, leagueId: string): string | null {
  return catalog.leagues.find((l) => l.id === leagueId)?.slug ?? null;
}

function teamSummary(catalog: Catalog, t: TeamRow): { name: string; key: string; league: string | null } {
  return { name: clean(t.name), key: clean(t.key), league: leagueSlugOf(catalog, t.leagueId) };
}

/**
 * League filter: an unknown league slug is a not_found (with the known
 * slugs), never a silent "no filter".
 */
function filterLeague(
  catalog: Catalog,
  leagueSlug: string | undefined,
): { ok: true; leagueIds: string[] | null } | { ok: false; error: LeagueNotFound } {
  if (leagueSlug === undefined) return { ok: true, leagueIds: null };
  const hit = catalog.leagues.find((l) => normalize(l.slug) === normalize(leagueSlug));
  if (!hit) {
    return {
      ok: false,
      error: {
        status: "not_found",
        note: `Unknown league "${clean(leagueSlug)}".`,
        knownLeagues: catalog.leagues.map((l) => clean(l.slug)),
      },
    };
  }
  return { ok: true, leagueIds: [hit.id] };
}

type LeagueNotFound = {
  status: "not_found";
  note: string;
  knownLeagues: string[];
};

type TeamLookupFailure =
  | { status: "unavailable"; reason: string }
  | { status: "not_found"; note: string; suggestions: { name: string; key: string; league: string | null }[]; knownLeagues?: string[] }
  | {
      status: "ambiguous";
      note: string;
      didYouMean: { name: string; key: string; league: string | null }[];
    };

function resolveTeamOrFail(
  catalog: Catalog,
  query: string,
  leagueSlug: string | undefined,
): { ok: true; team: TeamRow } | { ok: false; error: TeamLookupFailure } {
  if (catalog.teams.length === 0) {
    return {
      ok: false,
      error: {
        status: "unavailable",
        reason: "not yet ingested — the teams table is empty (the provider ingestion wave has not landed)",
      },
    };
  }
  const lf = filterLeague(catalog, leagueSlug);
  if (!lf.ok) {
    return {
      ok: false,
      error: { status: "not_found", note: lf.error.note, suggestions: [], knownLeagues: lf.error.knownLeagues },
    };
  }
  const leagueIds = lf.leagueIds;
  const pool = leagueIds ? catalog.teams.filter((t) => leagueIds.includes(t.leagueId)) : catalog.teams;
  const res = resolveByScore(
    pool,
    query,
    (t) => t.id,
    (t) => [t.key, t.name, t.shortName, t.abbreviation],
  );
  switch (res.kind) {
    case "resolved":
      return { ok: true, team: res.row };
    case "ambiguous":
      return {
        ok: false,
        error: {
          status: "ambiguous",
          note: `"${clean(query)}" matches more than one team — did you mean one of these? Ask the user, never guess.`,
          didYouMean: res.candidates.map((t) => teamSummary(catalog, t)),
        },
      };
    case "not_found":
    case "empty":
      return {
        ok: false,
        error: {
          status: "not_found",
          note: `No team matching "${clean(query)}" in the canonical database.`,
          suggestions: (res.kind === "not_found" ? res.suggestions : []).map((t) =>
            teamSummary(catalog, t),
          ),
        },
      };
  }
}

// ─── Serializers ────────────────────────────────────────────────────────────

type PublicGame = {
  eventId: string;
  providerEventId: string;
  league: string | null;
  startsAt: string;
  status: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
};

function publicGame(catalog: Catalog, e: EventRow): PublicGame {
  return {
    eventId: e.id,
    providerEventId: clean(e.providerEventId),
    league: leagueSlugOf(catalog, e.leagueId),
    startsAt: e.startsAt.toISOString(),
    status: e.status,
    homeTeam: clean(e.homeTeam),
    awayTeam: clean(e.awayTeam),
    homeScore: e.homeScore,
    awayScore: e.awayScore,
  };
}

function sideOf(e: EventRow, team: TeamRow): "home" | "away" | null {
  if (e.homeTeamId === team.id || (e.homeTeamKey !== null && e.homeTeamKey === team.key)) return "home";
  if (e.awayTeamId === team.id || (e.awayTeamKey !== null && e.awayTeamKey === team.key)) return "away";
  if (normalize(e.homeTeam) === normalize(team.name)) return "home";
  if (normalize(e.awayTeam) === normalize(team.name)) return "away";
  return null;
}

function opponentOf(e: EventRow, side: "home" | "away"): { name: string; key: string | null } {
  return side === "home"
    ? { name: clean(e.awayTeam), key: e.awayTeamKey === null ? null : clean(e.awayTeamKey) }
    : { name: clean(e.homeTeam), key: e.homeTeamKey === null ? null : clean(e.homeTeamKey) };
}

function publicMarket(e: EventRow, m: MarketRow): Record<string, unknown> {
  const side = m.outcomeIndex === 0 ? e.homeTeam : e.awayTeam;
  return {
    marketId: m.marketId,
    marketType: m.marketType,
    outcomeIndex: m.outcomeIndex,
    outcomeLabel: `${clean(side)} to win`,
    state: m.state,
    poolDeployed: m.poolId !== null,
    openingProbability: m.openingProbability === null ? null : Number(m.openingProbability),
  };
}

const NOT_YET_INGESTED = "not yet ingested";

function isFinal(e: EventRow): boolean {
  return e.status === "final" && e.homeScore !== null && e.awayScore !== null;
}

// ─── team_records helpers (task 041) ────────────────────────────────────────

/** Typed stat aggregates off a record row's jsonb (history.ts reader). */
function recordStats(row: TeamRecordRow): StatMap | null {
  return teamSeasonStats(row.stats);
}

/**
 * The snapshot a "current record/standings" question means: the latest
 * season on file, preferring the regular-season snapshot when several
 * season types exist for it.
 */
function pickLatestSeason(rows: readonly TeamRecordRow[]): { season: string; seasonType: string } | null {
  if (rows.length === 0) return null;
  const season = rows.reduce((max, r) => (r.season > max ? r.season : max), rows[0].season);
  const ofSeason = rows.filter((r) => r.season === season);
  const seasonType = ofSeason.some((r) => r.seasonType === "regular")
    ? "regular"
    : ofSeason[0].seasonType;
  return { season, seasonType };
}

function publicTeamRecord(row: TeamRecordRow): Record<string, unknown> {
  return {
    season: clean(row.season),
    seasonType: clean(row.seasonType),
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    divisionRank: row.divisionRank,
    conferenceRank: row.conferenceRank,
    pointsFor: row.pointsFor,
    pointsAgainst: row.pointsAgainst,
    streak: row.streak === null ? null : clean(row.streak),
    homeRecord: row.homeRecord === null ? null : clean(row.homeRecord),
    awayRecord: row.awayRecord === null ? null : clean(row.awayRecord),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── S-011 get_game ─────────────────────────────────────────────────────────

export async function getGame(
  dbx: SportsToolsDb,
  raw: unknown,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const input = parseInput(getGameInput, raw, "get_game");
  const catalog = await loadCatalog(dbx);
  const resolved = resolveTeamOrFail(catalog, input.team, input.league);
  if (!resolved.ok) return resolved.error;
  const team = resolved.team;

  const teamEvents = await dbx.listEventsForTeam(team, 200);
  if (teamEvents.length === 0) {
    if (!(await dbx.hasAnyEvents())) {
      return {
        status: "unavailable",
        reason: `${NOT_YET_INGESTED} — no events in the canonical database yet`,
        team: teamSummary(catalog, team),
      };
    }
    return {
      status: "not_found",
      note: `No games recorded for ${clean(team.name)}.`,
      team: teamSummary(catalog, team),
    };
  }

  let candidates: EventRow[];
  let windowNote: string | null = null;
  if (input.date !== undefined) {
    const windowDays = input.windowDays ?? 3;
    const dayStart = new Date(`${input.date}T00:00:00Z`).getTime();
    const from = dayStart - windowDays * 86_400_000;
    const to = dayStart + (windowDays + 1) * 86_400_000;
    candidates = teamEvents.filter((e) => e.startsAt.getTime() >= from && e.startsAt.getTime() < to);
    if (candidates.length === 0) {
      const nearest = [...teamEvents]
        .sort(
          (a, b) =>
            Math.abs(a.startsAt.getTime() - dayStart) - Math.abs(b.startsAt.getTime() - dayStart),
        )
        .at(0);
      return {
        status: "not_found",
        note: `No ${clean(team.name)} game within ${String(windowDays)} days of ${input.date}.`,
        team: teamSummary(catalog, team),
        nearestGame: nearest ? publicGame(catalog, nearest) : null,
      };
    }
    const target = dayStart + 12 * 3_600_000;
    candidates = [...candidates].sort(
      (a, b) => Math.abs(a.startsAt.getTime() - target) - Math.abs(b.startsAt.getTime() - target),
    );
    if (candidates.length > 1) {
      windowNote = `${String(candidates.length)} games in the window; returning the closest to ${input.date}.`;
    }
  } else {
    const live = teamEvents.filter((e) => e.status === "in_progress");
    const upcoming = teamEvents
      .filter((e) => e.status === "scheduled" && e.startsAt.getTime() >= now.getTime())
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    candidates = live.length > 0 ? live : upcoming.length > 0 ? upcoming : teamEvents;
  }

  const event = candidates.at(0);
  if (event === undefined) {
    return { status: "not_found", note: `No game found for ${clean(team.name)}.` };
  }
  const side = sideOf(event, team) ?? "home";
  const eventMarkets = await dbx.listMarketsForEvent(event.id);
  return {
    status: "ok",
    team: teamSummary(catalog, team),
    teamSide: side,
    opponent: opponentOf(event, side),
    game: publicGame(catalog, event),
    markets: eventMarkets.map((m) => publicMarket(event, m)),
    ...(eventMarkets.length === 0
      ? { marketsNote: "no markets recorded for this game yet (created at market-generation time)" }
      : {}),
    ...(windowNote !== null ? { note: windowNote } : {}),
    ...(input.date === undefined
      ? {}
      : {
          otherGamesInWindow: candidates.slice(1, 5).map((e) => publicGame(catalog, e)),
        }),
  };
}

// ─── S-012 get_live_game_state ──────────────────────────────────────────────

export async function getLiveGameState(
  dbx: SportsToolsDb,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = parseInput(gameRefInput, raw, "get_live_game_state");
  if (input.team === undefined && input.providerEventId === undefined) {
    throw new Error("get_live_game_state: provide `team` or `providerEventId`");
  }
  const catalog = await loadCatalog(dbx);

  let event: EventRow;
  if (input.providerEventId !== undefined) {
    const found = await dbx.getEventByProviderEventId(input.providerEventId);
    if (!found) {
      if (!(await dbx.hasAnyEvents())) {
        return { status: "unavailable", reason: `${NOT_YET_INGESTED} — no events in the canonical database yet` };
      }
      return { status: "not_found", note: `No event with providerEventId ${clean(input.providerEventId)}.` };
    }
    event = found;
  } else {
    const resolved = resolveTeamOrFail(catalog, input.team ?? "", input.league);
    if (!resolved.ok) return resolved.error;
    const teamEvents = await dbx.listEventsForTeam(resolved.team, 50);
    const live = teamEvents.find((e) => e.status === "in_progress");
    if (!live) {
      const latest = teamEvents.at(0);
      return {
        status: "not_found",
        note: `No ${clean(resolved.team.name)} game is in progress right now.`,
        latestGame: latest ? publicGame(catalog, latest) : null,
      };
    }
    event = live;
  }

  if (event.status !== "in_progress") {
    return {
      status: "not_found",
      note: `That game is not in progress (status: ${event.status}).`,
      game: publicGame(catalog, event),
    };
  }
  // Task 041: period/clock/possession derive from the latest ingested play
  // (game_plays), when the pbp pass has reached this game. Fields the play
  // log cannot support stay null with the reason — never invented.
  const latestPlay = (await dbx.listPlaysForEvent(event.id, 1)).at(0);
  const playDetail =
    latestPlay && typeof latestPlay.detail === "object" && latestPlay.detail !== null
      ? (latestPlay.detail as Record<string, unknown>)
      : {};
  // The ball after the latest play (`possessionAfter`, from the feed's
  // end_situation) beats the possession at its start.
  const possessionRaw =
    typeof playDetail["possessionAfter"] === "string"
      ? playDetail["possessionAfter"]
      : (latestPlay?.teamKey ?? null);

  const period = latestPlay?.period ?? null;
  const clock = latestPlay?.clock ?? null;
  const possession = possessionRaw === null ? null : clean(possessionRaw);

  const fieldsNotStored: Record<string, string> = {};
  const missingReason = latestPlay
    ? "the latest ingested play does not carry this field"
    : `${NOT_YET_INGESTED} — no plays ingested for this game yet`;
  if (period === null) fieldsNotStored["period"] = missingReason;
  if (clock === null) fieldsNotStored["clock"] = missingReason;
  if (possession === null) fieldsNotStored["possession"] = missingReason;

  return {
    status: "ok",
    game: publicGame(catalog, event),
    score: { home: event.homeScore, away: event.awayScore },
    period,
    clock: clock === null ? null : clean(clock),
    possession,
    ...(latestPlay ? { liveStateSource: "derived from the latest ingested play (game_plays)" } : {}),
    ...(Object.keys(fieldsNotStored).length > 0 ? { fieldsNotStored } : {}),
  };
}

// ─── S-013 get_team_stats ───────────────────────────────────────────────────

export async function getTeamStats(dbx: SportsToolsDb, raw: unknown): Promise<Record<string, unknown>> {
  const input = parseInput(teamInput, raw, "get_team_stats");
  const catalog = await loadCatalog(dbx);
  const resolved = resolveTeamOrFail(catalog, input.team, input.league);
  if (!resolved.ok) return resolved.error;
  const team = resolved.team;

  // Task 041: prefer the ingested standings snapshot (team_records) — the
  // official record with ranks, streak, splits, and the S-007 stat
  // aggregates. The derived-from-events record below remains the fallback.
  const recordRows = await dbx.listTeamRecordsForTeam(team.id);
  const pick = pickLatestSeason(recordRows);
  if (pick !== null) {
    const best = recordRows.find(
      (r) => r.season === pick.season && r.seasonType === pick.seasonType,
    );
    if (best !== undefined) {
      const detailed = recordStats(best);
      return {
        status: "ok",
        team: teamSummary(catalog, team),
        record: publicTeamRecord(best),
        recordSource: "official standings feed (team_records)",
        detailedStats:
          detailed !== null
            ? { status: "ok", source: "team_records.stats", stats: detailed }
            : {
                status: "unavailable",
                reason: `${NOT_YET_INGESTED} — the standings feed carried no stat aggregates for this team`,
              },
      };
    }
  }

  const finals = (await dbx.listEventsForTeam(team, 200)).filter(isFinal);

  let record: Record<string, unknown> | null = null;
  if (finals.length > 0) {
    let wins = 0;
    let losses = 0;
    let ties = 0;
    let pointsFor = 0;
    let pointsAgainst = 0;
    for (const e of finals) {
      const side = sideOf(e, team);
      if (side === null || e.homeScore === null || e.awayScore === null) continue;
      const us = side === "home" ? e.homeScore : e.awayScore;
      const them = side === "home" ? e.awayScore : e.homeScore;
      pointsFor += us;
      pointsAgainst += them;
      if (us > them) wins += 1;
      else if (us < them) losses += 1;
      else ties += 1;
    }
    record = { wins, losses, ties, pointsFor, pointsAgainst, gamesCounted: finals.length };
  }

  return {
    status: "ok",
    team: teamSummary(catalog, team),
    derivedRecord: record,
    ...(record === null
      ? { derivedRecordNote: `no finished games recorded for this team (${NOT_YET_INGESTED} or season not started)` }
      : { derivedRecordNote: "derived from finished games in the canonical database" }),
    detailedStats: {
      status: "unavailable",
      reason: `${NOT_YET_INGESTED} — no standings snapshot for this team in team_records yet`,
    },
  };
}

// ─── S-014 get_player_stats ─────────────────────────────────────────────────

interface PlayerContext {
  catalog: Catalog;
  players: PlayerRow[];
}

function playerTeamName(ctx: PlayerContext, p: PlayerRow): string | null {
  if (p.teamId === null) return null;
  const t = ctx.catalog.teams.find((x) => x.id === p.teamId);
  return t ? clean(t.name) : null;
}

function publicPlayer(ctx: PlayerContext, p: PlayerRow): Record<string, unknown> {
  return {
    playerId: p.id,
    name: clean(p.name),
    position: p.position === null ? null : clean(p.position),
    jerseyNumber: p.jerseyNumber,
    rosterStatus: p.status,
    team: playerTeamName(ctx, p),
    league: leagueSlugOf(ctx.catalog, p.leagueId),
  };
}

async function resolvePlayerOrFail(
  dbx: SportsToolsDb,
  catalog: Catalog,
  query: string,
  teamQuery: string | undefined,
  leagueSlug: string | undefined,
): Promise<{ ok: true; ctx: PlayerContext; player: PlayerRow } | { ok: false; error: Record<string, unknown> }> {
  const allPlayers = await dbx.listPlayers();
  const ctx: PlayerContext = { catalog, players: allPlayers };
  if (allPlayers.length === 0) {
    return {
      ok: false,
      error: {
        status: "unavailable",
        reason: `${NOT_YET_INGESTED} — the players table is empty (roster ingestion has not landed)`,
      },
    };
  }
  const lf = filterLeague(catalog, leagueSlug);
  if (!lf.ok) return { ok: false, error: lf.error };
  const leagueIds = lf.leagueIds;
  let pool = leagueIds ? allPlayers.filter((p) => leagueIds.includes(p.leagueId)) : allPlayers;
  if (teamQuery !== undefined) {
    const teamRes = resolveTeamOrFail(catalog, teamQuery, leagueSlug);
    if (!teamRes.ok) return { ok: false, error: teamRes.error };
    pool = pool.filter((p) => p.teamId === teamRes.team.id);
  }
  const res = resolveByScore(
    pool,
    query,
    (p) => p.id,
    (p) => [p.name],
  );
  switch (res.kind) {
    case "resolved":
      return { ok: true, ctx, player: res.row };
    case "ambiguous":
      return {
        ok: false,
        error: {
          status: "ambiguous",
          note: `"${clean(query)}" matches more than one player — did you mean one of these? Ask the user, never guess.`,
          didYouMean: res.candidates.map((p) => publicPlayer(ctx, p)),
        },
      };
    case "not_found":
    case "empty":
      return {
        ok: false,
        error: {
          status: "not_found",
          note: `No player matching "${clean(query)}" in the canonical database.`,
        },
      };
  }
}

export async function getPlayerStats(dbx: SportsToolsDb, raw: unknown): Promise<Record<string, unknown>> {
  const input = parseInput(playerStatsInput, raw, "get_player_stats");
  const catalog = await loadCatalog(dbx);
  const resolved = await resolvePlayerOrFail(dbx, catalog, input.player, input.team, input.league);
  if (!resolved.ok) return resolved.error;

  // Task 041: serve `players.season_stats` when present. No pinned feed
  // writes it yet (the Sportradar seasonal-statistics endpoint costs one
  // call per team and does not fit the trial quota — see the 041 task doc),
  // so the honest empty answer remains the common case.
  const seasonJson = await dbx.getPlayerSeasonStats(resolved.player.id);
  const seasons: Record<string, StatMap> = {};
  if (typeof seasonJson === "object" && seasonJson !== null && !Array.isArray(seasonJson)) {
    for (const label of Object.keys(seasonJson)) {
      if (input.season !== undefined && label !== input.season) continue;
      const stats = playerSeasonStats(seasonJson, label);
      if (stats !== null) seasons[clean(label)] = stats;
    }
  }

  const seasonLabels = Object.keys(seasons);
  return {
    status: "ok",
    player: publicPlayer(resolved.ctx, resolved.player),
    stats:
      seasonLabels.length > 0
        ? { status: "ok", source: "players.season_stats", seasons }
        : {
            status: "unavailable",
            reason:
              input.season !== undefined
                ? `${NOT_YET_INGESTED} — no season_stats entry for season "${clean(input.season)}" for this player`
                : `${NOT_YET_INGESTED} — no season stat line stored for this player`,
          },
  };
}

// ─── S-015 get_player_injury_status ─────────────────────────────────────────

function publicInjury(r: OpenInjuryRow): Record<string, unknown> {
  return {
    player: r.playerName === null ? null : clean(r.playerName),
    position: r.position === null ? null : clean(r.position),
    status: r.status,
    description: r.description === null ? null : clean(r.description),
    reportedAt: r.reportedAt.toISOString(),
    providerUpdatedAt: r.providerUpdatedAt === null ? null : r.providerUpdatedAt.toISOString(),
  };
}

export async function getPlayerInjuryStatus(
  dbx: SportsToolsDb,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = parseInput(injuryInput, raw, "get_player_injury_status");
  if (input.player === undefined && input.team === undefined) {
    throw new Error("get_player_injury_status: provide `player` or `team`");
  }
  const catalog = await loadCatalog(dbx);

  if (input.player !== undefined) {
    const resolved = await resolvePlayerOrFail(dbx, catalog, input.player, input.team, input.league);
    if (!resolved.ok) return resolved.error;
    const rows = await dbx.listOpenInjuriesForPlayer(resolved.player.id);
    if (rows.length === 0) {
      const feedEmpty = !(await dbx.hasAnyInjuries());
      return {
        status: "ok",
        player: publicPlayer(resolved.ctx, resolved.player),
        openInjuries: [],
        note: feedEmpty
          ? `no injury rows in the canonical database at all — the injury feed is ${NOT_YET_INGESTED}, so absence here is NOT evidence the player is healthy`
          : "no open injury report — the player is not currently listed",
      };
    }
    return {
      status: "ok",
      player: publicPlayer(resolved.ctx, resolved.player),
      openInjuries: rows.map(publicInjury),
    };
  }

  const teamRes = resolveTeamOrFail(catalog, input.team ?? "", input.league);
  if (!teamRes.ok) return teamRes.error;
  const rows = await dbx.listOpenInjuriesForTeam(teamRes.team.id);
  if (rows.length === 0) {
    const feedEmpty = !(await dbx.hasAnyInjuries());
    return {
      status: "ok",
      team: teamSummary(catalog, teamRes.team),
      openInjuries: [],
      note: feedEmpty
        ? `no injury rows in the canonical database at all — the injury feed is ${NOT_YET_INGESTED}, so absence here is NOT evidence the roster is healthy`
        : "no open injury reports for this team",
    };
  }
  return {
    status: "ok",
    team: teamSummary(catalog, teamRes.team),
    openInjuries: rows.map(publicInjury),
  };
}

// ─── S-016 get_recent_games ─────────────────────────────────────────────────

export async function getRecentGames(dbx: SportsToolsDb, raw: unknown): Promise<Record<string, unknown>> {
  const input = parseInput(recentGamesInput, raw, "get_recent_games");
  const limit = input.limit ?? 5;
  const catalog = await loadCatalog(dbx);
  const resolved = resolveTeamOrFail(catalog, input.team, input.league);
  if (!resolved.ok) return resolved.error;
  const team = resolved.team;
  const finals = (await dbx.listEventsForTeam(team, 200)).filter(isFinal).slice(0, limit);
  if (finals.length === 0) {
    if (!(await dbx.hasAnyEvents())) {
      return {
        status: "unavailable",
        reason: `${NOT_YET_INGESTED} — no events in the canonical database yet`,
        team: teamSummary(catalog, team),
      };
    }
    return {
      status: "ok",
      team: teamSummary(catalog, team),
      games: [],
      note: "no finished games recorded for this team yet",
    };
  }
  return {
    status: "ok",
    team: teamSummary(catalog, team),
    games: finals.map((e) => {
      const side = sideOf(e, team) ?? "home";
      const us = side === "home" ? e.homeScore : e.awayScore;
      const them = side === "home" ? e.awayScore : e.homeScore;
      const result =
        us === null || them === null ? "unknown" : us > them ? "W" : us < them ? "L" : "T";
      return {
        ...publicGame(catalog, e),
        teamSide: side,
        opponent: opponentOf(e, side).name,
        result,
      };
    }),
  };
}

// ─── S-017 get_head_to_head ─────────────────────────────────────────────────

export async function getHeadToHead(dbx: SportsToolsDb, raw: unknown): Promise<Record<string, unknown>> {
  const input = parseInput(headToHeadInput, raw, "get_head_to_head");
  const limit = input.limit ?? 10;
  const catalog = await loadCatalog(dbx);
  const a = resolveTeamOrFail(catalog, input.teamA, input.league);
  if (!a.ok) return { ...a.error, forTeam: clean(input.teamA) };
  const b = resolveTeamOrFail(catalog, input.teamB, input.league);
  if (!b.ok) return { ...b.error, forTeam: clean(input.teamB) };
  if (a.team.id === b.team.id) {
    throw new Error("get_head_to_head: teamA and teamB resolved to the same team");
  }

  const meetings = (await dbx.listEventsForTeam(a.team, 200))
    .filter(isFinal)
    .filter((e) => {
      const sa = sideOf(e, a.team);
      const sb = sideOf(e, b.team);
      return sa !== null && sb !== null && sa !== sb;
    })
    .slice(0, limit);

  if (meetings.length === 0) {
    if (!(await dbx.hasAnyEvents())) {
      return { status: "unavailable", reason: `${NOT_YET_INGESTED} — no events in the canonical database yet` };
    }
    return {
      status: "ok",
      teams: [teamSummary(catalog, a.team), teamSummary(catalog, b.team)],
      games: [],
      note: "no finished meetings between these teams recorded",
    };
  }

  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  const games = meetings.map((e) => {
    const sa = sideOf(e, a.team) ?? "home";
    const usA = sa === "home" ? e.homeScore : e.awayScore;
    const themA = sa === "home" ? e.awayScore : e.homeScore;
    if (usA !== null && themA !== null) {
      if (usA > themA) aWins += 1;
      else if (usA < themA) bWins += 1;
      else ties += 1;
    }
    return { ...publicGame(catalog, e), [`${clean(a.team.name)}Side`]: sa };
  });
  return {
    status: "ok",
    teams: [teamSummary(catalog, a.team), teamSummary(catalog, b.team)],
    summary: { [clean(a.team.name)]: aWins, [clean(b.team.name)]: bWins, ties },
    games,
  };
}

// ─── S-018 get_standings ────────────────────────────────────────────────────

export async function getStandings(dbx: SportsToolsDb, raw: unknown): Promise<Record<string, unknown>> {
  const input = parseInput(standingsInput, raw, "get_standings");
  const catalog = await loadCatalog(dbx);
  if (catalog.leagues.length === 0) {
    return { status: "unavailable", reason: `${NOT_YET_INGESTED} — no leagues in the canonical database yet` };
  }
  const lf = filterLeague(catalog, input.league);
  if (!lf.ok) return lf.error;
  const leagueIds = lf.leagueIds;
  const wanted = leagueIds ? catalog.leagues.filter((l) => leagueIds.includes(l.id)) : catalog.leagues;

  const perLeague = await Promise.all(
    wanted.map(async (league) => {
      // Task 041: prefer the ingested standings snapshot (team_records) —
      // official wins/losses/ranks/streaks with `updatedAt` staleness. The
      // derived-from-finished-events table below stays the fallback.
      const recordRows = await dbx.listTeamRecordsForLeague(league.id);
      const pick = pickLatestSeason(recordRows);
      if (pick !== null) {
        const snapshot = recordRows.filter(
          (r) => r.season === pick.season && r.seasonType === pick.seasonType,
        );
        const teamsById = new Map(catalog.teams.map((t) => [t.id, t]));
        const nameOf = (r: TeamRecordRow): string => {
          const t = teamsById.get(r.teamId);
          return t ? t.name : "";
        };
        const rows = [...snapshot]
          .sort(
            (x, y) =>
              (x.divisionRank ?? Number.MAX_SAFE_INTEGER) -
                (y.divisionRank ?? Number.MAX_SAFE_INTEGER) ||
              y.wins - x.wins ||
              nameOf(x).localeCompare(nameOf(y)),
          )
          .map((r) => {
            const t = teamsById.get(r.teamId);
            return {
              team: t ? clean(t.name) : null,
              key: t ? clean(t.key) : null,
              ...publicTeamRecord(r),
            };
          });
        let asOf = 0;
        for (const r of snapshot) asOf = Math.max(asOf, r.updatedAt.getTime());
        return {
          league: clean(league.slug),
          source: "team_records" as const,
          season: clean(pick.season),
          seasonType: clean(pick.seasonType),
          asOf: new Date(asOf).toISOString(),
          standings: rows,
        };
      }

      const finals = (await dbx.listEventsForLeague(league.id, 1000)).filter(isFinal);
      const table = new Map<
        string,
        { team: string; wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }
      >();
      const bump = (
        key: string | null,
        name: string,
        us: number,
        them: number,
      ): void => {
        const k = key ?? normalize(name);
        const row = table.get(k) ?? {
          team: clean(name),
          wins: 0,
          losses: 0,
          ties: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };
        row.pointsFor += us;
        row.pointsAgainst += them;
        if (us > them) row.wins += 1;
        else if (us < them) row.losses += 1;
        else row.ties += 1;
        table.set(k, row);
      };
      for (const e of finals) {
        if (e.homeScore === null || e.awayScore === null) continue;
        bump(e.homeTeamKey, e.homeTeam, e.homeScore, e.awayScore);
        bump(e.awayTeamKey, e.awayTeam, e.awayScore, e.homeScore);
      }
      const rows = [...table.values()]
        .map((r) => {
          const games = r.wins + r.losses + r.ties;
          return { ...r, winPct: games === 0 ? 0 : Number(((r.wins + r.ties / 2) / games).toFixed(3)) };
        })
        .sort((x, y) => y.winPct - x.winPct || y.wins - x.wins || x.team.localeCompare(y.team));
      return { league: clean(league.slug), source: "derived" as const, standings: rows };
    }),
  );

  const nonEmpty = perLeague.filter((l) => l.standings.length > 0);
  if (nonEmpty.length === 0) {
    return {
      status: "unavailable",
      reason: `${NOT_YET_INGESTED} — no standings snapshot and no finished games to derive one from`,
    };
  }
  const anyDerived = perLeague.some((l) => l.source === "derived" && l.standings.length > 0);
  const anyOfficial = perLeague.some((l) => l.source === "team_records");
  return {
    status: "ok",
    leagues: perLeague,
    note: [
      ...(anyOfficial
        ? ['leagues marked source "team_records" serve the ingested official standings snapshot (asOf = its last refresh)']
        : []),
      ...(anyDerived
        ? ['leagues marked source "derived" are aggregated from finished games — no official snapshot ingested for them yet']
        : []),
    ].join("; "),
  };
}

// ─── S-019 get_play_by_play ─────────────────────────────────────────────────

const playByPlayInput = z
  .object({
    team: nameQuery.optional(),
    league: leagueQuery,
    providerEventId: providerEventIdSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export async function getPlayByPlay(dbx: SportsToolsDb, raw: unknown): Promise<Record<string, unknown>> {
  const input = parseInput(playByPlayInput, raw, "get_play_by_play");
  if (input.team === undefined && input.providerEventId === undefined) {
    throw new Error("get_play_by_play: provide `team` or `providerEventId`");
  }
  const catalog = await loadCatalog(dbx);

  // Resolve the game: exact id wins; a team query prefers the live game,
  // then the most recent game that has actually started (a scheduled game
  // cannot have plays), then whatever is newest.
  let event: EventRow | null;
  if (input.providerEventId !== undefined) {
    event = await dbx.getEventByProviderEventId(input.providerEventId);
    if (!event) {
      if (!(await dbx.hasAnyEvents())) {
        return { status: "unavailable", reason: `${NOT_YET_INGESTED} — no events in the canonical database yet` };
      }
      return { status: "not_found", note: `No event with providerEventId ${clean(input.providerEventId)}.` };
    }
  } else {
    const resolved = resolveTeamOrFail(catalog, input.team ?? "", input.league);
    if (!resolved.ok) return resolved.error;
    const teamEvents = await dbx.listEventsForTeam(resolved.team, 50);
    event =
      teamEvents.find((e) => e.status === "in_progress") ??
      teamEvents.find((e) => e.status === "final") ??
      teamEvents.at(0) ??
      null;
    if (!event) {
      return {
        status: "not_found",
        note: `No games recorded for ${clean(resolved.team.name)}.`,
        team: teamSummary(catalog, resolved.team),
      };
    }
  }

  // Task 041: the plays come from the ingested `game_plays` log. Empty is a
  // structured unavailable — the pbp pass only covers live and just-finished
  // games, so a scheduled or long-past game honestly has no stored plays.
  const limit = input.limit ?? 40;
  const plays = await dbx.listPlaysForEvent(event.id, limit);
  if (plays.length === 0) {
    return {
      status: "unavailable",
      reason: `${NOT_YET_INGESTED} — no plays stored for this game (play-by-play ingestion covers live and just-finished games)`,
      plays: null,
      game: publicGame(catalog, event),
    };
  }
  return {
    status: "ok",
    game: publicGame(catalog, event),
    order: "newest first",
    count: plays.length,
    plays: plays.map((p) => ({
      sequence: p.sequence,
      period: p.period,
      clock: p.clock === null ? null : clean(p.clock),
      playType: p.playType === null ? null : clean(p.playType),
      description: p.description === null ? null : clean(p.description),
      team: p.teamKey === null ? null : clean(p.teamKey),
      scoringPlay: p.scoringPlay,
      homeScore: p.homeScore,
      awayScore: p.awayScore,
    })),
  };
}

// ─── S-020 market tools ─────────────────────────────────────────────────────

const USDC_DECIMALS = 1e6;

export async function getMarketPrice(dbx: SportsToolsDb, raw: unknown, now: Date = new Date()): Promise<Record<string, unknown>> {
  const input = parseInput(marketIdInput, raw, "get_market_price");
  const market = await dbx.getMarket(input.marketId);
  if (!market) {
    return {
      status: "not_found",
      note: "No market with this id in the canonical database — take marketIds from get_game.",
    };
  }
  const latest = (await dbx.listMarketPrices(input.marketId, 1)).at(0);
  if (!latest) {
    return {
      status: "unavailable",
      reason: `${NOT_YET_INGESTED} — no price captures for this market yet (pool not seeded or the price sweep hasn't run)`,
      market: {
        marketId: market.marketId,
        state: market.state,
        outcomeIndex: market.outcomeIndex,
        openingProbability:
          market.openingProbability === null ? null : Number(market.openingProbability),
      },
    };
  }
  const p = Number(latest.impliedProbability);
  return {
    status: "ok",
    marketId: market.marketId,
    state: market.state,
    outcomeIndex: market.outcomeIndex,
    impliedProbability: p,
    impliedProbabilityBps: Math.round(p * 10_000),
    source: latest.source,
    capturedAt: latest.capturedAt.toISOString(),
    ageSeconds: Math.max(0, Math.round((now.getTime() - latest.capturedAt.getTime()) / 1000)),
  };
}

export async function getMarketHistory(dbx: SportsToolsDb, raw: unknown): Promise<Record<string, unknown>> {
  const input = parseInput(marketHistoryInput, raw, "get_market_history");
  const market = await dbx.getMarket(input.marketId);
  if (!market) {
    return {
      status: "not_found",
      note: "No market with this id in the canonical database — take marketIds from get_game.",
    };
  }
  const limit = input.limit ?? 50;
  const rows = await dbx.listMarketPrices(input.marketId, limit);
  if (rows.length === 0) {
    return {
      status: "unavailable",
      reason: `${NOT_YET_INGESTED} — no price history captured for this market yet`,
      marketId: market.marketId,
    };
  }
  const series = [...rows]
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
    .map((r) => ({
      capturedAt: r.capturedAt.toISOString(),
      impliedProbability: Number(r.impliedProbability),
      source: r.source,
    }));
  const first = series.at(0);
  const last = series.at(-1);
  return {
    status: "ok",
    marketId: market.marketId,
    points: series,
    count: series.length,
    ...(first !== undefined && last !== undefined
      ? {
          changeOverWindow: Number((last.impliedProbability - first.impliedProbability).toFixed(5)),
        }
      : {}),
  };
}

export async function getMarketVolume(
  dbx: SportsToolsDb,
  raw: unknown,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const input = parseInput(marketVolumeInput, raw, "get_market_volume");
  const market = await dbx.getMarket(input.marketId);
  if (!market) {
    return {
      status: "not_found",
      note: "No market with this id in the canonical database — take marketIds from get_game.",
    };
  }
  const windowHours = input.windowHours ?? 24;
  const since = new Date(now.getTime() - windowHours * 3_600_000);
  const fills = await dbx.listMarketFillsSince(input.marketId, since);
  let buys = 0;
  let sells = 0;
  let buyUsdc = 0;
  let sellUsdc = 0;
  let tokens = 0;
  for (const f of fills) {
    const usdc = Number(f.usdcRaw) / USDC_DECIMALS;
    tokens += Number(f.tokensRaw) / USDC_DECIMALS;
    if (f.direction === "buy") {
      buys += 1;
      buyUsdc += usdc;
    } else {
      sells += 1;
      sellUsdc += usdc;
    }
  }
  return {
    status: "ok",
    marketId: market.marketId,
    windowHours,
    trades: fills.length,
    buys,
    sells,
    buyVolumeUsdc: Number(buyUsdc.toFixed(6)),
    sellVolumeUsdc: Number(sellUsdc.toFixed(6)),
    totalVolumeUsdc: Number((buyUsdc + sellUsdc).toFixed(6)),
    tokensTraded: Number(tokens.toFixed(6)),
    ...(fills.length === 0
      ? {
          note: "zero fills recorded in the window — the fill index only sees confirmed app trades, so this is either genuinely no trading or indexing still pending; do not infer illiquidity from it alone",
        }
      : {}),
  };
}

export async function getMarketLiquidity(dbx: SportsToolsDb, raw: unknown): Promise<Record<string, unknown>> {
  const input = parseInput(marketIdInput, raw, "get_market_liquidity");
  const market = await dbx.getMarket(input.marketId);
  if (!market) {
    return {
      status: "not_found",
      note: "No market with this id in the canonical database — take marketIds from get_game.",
    };
  }
  if (market.poolId === null) {
    // Graceful pre-deployment answer: the market row exists but its pool
    // hasn't been seeded on-chain yet.
    return {
      status: "ok",
      marketId: market.marketId,
      state: market.state,
      poolDeployed: false,
      liquidityUsdc: null,
      note: "pool not deployed yet — liquidity is null until the market pool is seeded on-chain",
    };
  }
  const captures = await dbx.listMarketPrices(input.marketId, 25);
  const withDepth = captures.find((c) => c.liquidityRaw !== null);
  if (!withDepth || withDepth.liquidityRaw === null) {
    return {
      status: "ok",
      marketId: market.marketId,
      state: market.state,
      poolDeployed: true,
      liquidityUsdc: null,
      note: `pool is deployed but no depth capture is recorded yet (${NOT_YET_INGESTED})`,
    };
  }
  return {
    status: "ok",
    marketId: market.marketId,
    state: market.state,
    poolDeployed: true,
    liquidityUsdc: Number((Number(withDepth.liquidityRaw) / USDC_DECIMALS).toFixed(6)),
    asOf: withDepth.capturedAt.toISOString(),
  };
}
