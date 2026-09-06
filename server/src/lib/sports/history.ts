/**
 * 038 / S-008 — the historical read layer over the canonical sports tables.
 *
 * Answers the agent's history questions from OUR OWN database — finished
 * `events` rows, `team_records` standings, season-stat jsonb, and Mantua's
 * `market_prices` series — never a live provider call and never a web
 * search. Every entry point returns an explicit {@link HistoryResult}:
 * when the canonical tables cannot support an answer, the result says
 * `insufficient_data` with a human-readable detail. **Nothing here
 * fabricates** — an empty table is an honest "we don't know yet",
 * because ingestion wiring for the 0013 tables is a sibling task.
 *
 * Structure: pure `compute*` functions over plain row shapes (unit-tested
 * against fixture rows, no DB), plus thin drizzle fetch wrappers that feed
 * them — the strategy-engine testing pattern.
 */

import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import {
  events,
  leagues,
  markets,
  marketPrices,
  teamRecords,
  teams,
  type Player,
  type TeamRecord,
} from "../../db/schema/index.ts";

// ─── Result envelope ─────────────────────────────────────────────────────────

/** Every history answer is either data or an explicit refusal to guess. */
export type HistoryResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "insufficient_data"; detail: string };

export function insufficientData<T>(detail: string): HistoryResult<T> {
  return { ok: false, reason: "insufficient_data", detail };
}

function okResult<T>(data: T): HistoryResult<T> {
  return { ok: true, data };
}

// ─── Row shapes (pure layer) ─────────────────────────────────────────────────

/** A finished game as the pure functions consume it. */
export interface FinishedGameRow {
  providerEventId: string;
  startsAt: Date;
  homeTeamKey: string | null;
  awayTeamKey: string | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  /** Opening implied probability of the HOME moneyline market (0–1),
   *  when a Mantua market existed for the game. Decimal string per the
   *  numeric-column convention; null when no market was minted. */
  homeOpeningProbability?: string | null;
}

export interface TeamGameSummary {
  providerEventId: string;
  /** Unix seconds. */
  startsAt: number;
  homeAway: "home" | "away";
  opponentKey: string | null;
  opponentName: string;
  teamScore: number;
  opponentScore: number;
  result: "W" | "L" | "T";
  /** teamScore − opponentScore. */
  margin: number;
}

export interface WinLossLine {
  games: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface HeadToHeadSummary {
  games: TeamGameSummary[];
  teamAKey: string;
  teamBKey: string;
  aWins: number;
  bWins: number;
  ties: number;
  /** Unix seconds of the most recent meeting. */
  lastMeetingAt: number;
}

export interface HomeAwaySplits {
  teamKey: string;
  home: WinLossLine;
  away: WinLossLine;
}

export interface SituationalTrends {
  teamKey: string;
  /** Results of the most recent games, newest first, e.g. ["W","W","L"]. */
  recentForm: ("W" | "L" | "T")[];
  currentStreak: { kind: "W" | "L" | "T"; count: number };
  avgMargin: number;
  /** Record when Mantua's opening line favored the team (opening
   *  probability ≥ 0.5 on its side). Null when no game carried a Mantua
   *  opening line — derivable only from our own market data. */
  asFavorite: WinLossLine | null;
  asUnderdog: WinLossLine | null;
}

// ─── Pure computations ───────────────────────────────────────────────────────

/** A row counts as a completed game only with both scores recorded. */
function isCompleted(
  row: FinishedGameRow,
): row is FinishedGameRow & { homeScore: number; awayScore: number } {
  return typeof row.homeScore === "number" && typeof row.awayScore === "number";
}

function involves(row: FinishedGameRow, teamKey: string): boolean {
  return row.homeTeamKey === teamKey || row.awayTeamKey === teamKey;
}

/**
 * Summaries of completed games from `teamKey`'s perspective, preserving
 * the input's ordering. Rows missing a score, or not involving the team,
 * are dropped — a scheduled or in-progress game is not history.
 */
export function summarizeTeamGames(
  teamKey: string,
  rows: readonly FinishedGameRow[],
): TeamGameSummary[] {
  const out: TeamGameSummary[] = [];
  for (const row of rows) {
    if (!isCompleted(row) || !involves(row, teamKey)) continue;
    const isHome = row.homeTeamKey === teamKey;
    const teamScore = isHome ? row.homeScore : row.awayScore;
    const opponentScore = isHome ? row.awayScore : row.homeScore;
    out.push({
      providerEventId: row.providerEventId,
      startsAt: Math.floor(row.startsAt.getTime() / 1000),
      homeAway: isHome ? "home" : "away",
      opponentKey: isHome ? row.awayTeamKey : row.homeTeamKey,
      opponentName: isHome ? row.awayTeam : row.homeTeam,
      teamScore,
      opponentScore,
      result: teamScore > opponentScore ? "W" : teamScore < opponentScore ? "L" : "T",
      margin: teamScore - opponentScore,
    });
  }
  return out;
}

function emptyLine(): WinLossLine {
  return { games: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
}

function addToLine(line: WinLossLine, g: TeamGameSummary): void {
  line.games += 1;
  if (g.result === "W") line.wins += 1;
  else if (g.result === "L") line.losses += 1;
  else line.ties += 1;
  line.pointsFor += g.teamScore;
  line.pointsAgainst += g.opponentScore;
}

/** Head-to-head record between two team keys over completed meetings. */
export function computeHeadToHead(
  teamAKey: string,
  teamBKey: string,
  rows: readonly FinishedGameRow[],
): HistoryResult<HeadToHeadSummary> {
  const meetings = rows.filter(
    (r) => isCompleted(r) && involves(r, teamAKey) && involves(r, teamBKey),
  );
  if (meetings.length === 0) {
    return insufficientData(
      `no completed meetings between ${teamAKey} and ${teamBKey} in the canonical events table`,
    );
  }
  const games = summarizeTeamGames(teamAKey, meetings);
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  for (const g of games) {
    if (g.result === "W") aWins += 1;
    else if (g.result === "L") bWins += 1;
    else ties += 1;
  }
  const lastMeetingAt = Math.max(...games.map((g) => g.startsAt));
  return okResult({ games, teamAKey, teamBKey, aWins, bWins, ties, lastMeetingAt });
}

/** Home/away record splits over completed games. */
export function computeHomeAwaySplits(
  teamKey: string,
  rows: readonly FinishedGameRow[],
): HistoryResult<HomeAwaySplits> {
  const games = summarizeTeamGames(teamKey, rows);
  if (games.length === 0) {
    return insufficientData(`no completed games for ${teamKey} in the canonical events table`);
  }
  const home = emptyLine();
  const away = emptyLine();
  for (const g of games) addToLine(g.homeAway === "home" ? home : away, g);
  return okResult({ teamKey, home, away });
}

/**
 * Situational trends derivable from canonical data alone: recent form,
 * streak, average margin, and favorite/underdog splits from Mantua's own
 * opening lines. `rows` must be ordered newest-first (the fetchers are).
 */
export function computeSituationalTrends(
  teamKey: string,
  rows: readonly FinishedGameRow[],
  recentWindow = 5,
): HistoryResult<SituationalTrends> {
  const completed = rows.filter((r) => isCompleted(r) && involves(r, teamKey));
  const games = summarizeTeamGames(teamKey, completed);
  if (games.length === 0) {
    return insufficientData(`no completed games for ${teamKey} in the canonical events table`);
  }

  const recentForm = games.slice(0, recentWindow).map((g) => g.result);
  const streakKind = games[0].result;
  let streakCount = 0;
  for (const g of games) {
    if (g.result !== streakKind) break;
    streakCount += 1;
  }
  const avgMargin = games.reduce((s, g) => s + g.margin, 0) / games.length;

  // Favorite/underdog per Mantua's own opening line (home market prob).
  let asFavorite: WinLossLine | null = null;
  let asUnderdog: WinLossLine | null = null;
  for (let i = 0; i < completed.length; i++) {
    const row = completed[i];
    const opening = row.homeOpeningProbability;
    if (opening == null) continue;
    const homeProb = Number(opening);
    if (!Number.isFinite(homeProb)) continue;
    const teamProb = row.homeTeamKey === teamKey ? homeProb : 1 - homeProb;
    const line = teamProb >= 0.5 ? (asFavorite ??= emptyLine()) : (asUnderdog ??= emptyLine());
    const summary = summarizeTeamGames(teamKey, [row]).at(0);
    if (summary) addToLine(line, summary);
  }

  return okResult({
    teamKey,
    recentForm,
    currentStreak: { kind: streakKind, count: streakCount },
    avgMargin,
    asFavorite,
    asUnderdog,
  });
}

// ─── Typed jsonb readers (S-007) ─────────────────────────────────────────────

/** A flat stat map: category slug → numeric value. Non-numeric entries drop. */
export type StatMap = Record<string, number>;

function toStatMap(value: unknown): StatMap | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const out: StatMap = {};
  let any = false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
      any = true;
    }
  }
  return any ? out : null;
}

/**
 * Player season aggregates from `players.season_stats` — the jsonb is
 * keyed by season label. Null (not `{}`) when the season is absent or
 * carries nothing numeric, so callers can't mistake "no data" for zeros.
 */
export function playerSeasonStats(
  seasonStatsJson: Player["seasonStats"],
  season: string,
): StatMap | null {
  if (typeof seasonStatsJson !== "object" || seasonStatsJson === null) return null;
  return toStatMap((seasonStatsJson as Record<string, unknown>)[season]);
}

/** Team season aggregates from `team_records.stats`. */
export function teamSeasonStats(statsJson: TeamRecord["stats"]): StatMap | null {
  return toStatMap(statsJson);
}

// ─── DB fetchers ─────────────────────────────────────────────────────────────

const FINISHED = "final";

const finishedGameColumns = {
  providerEventId: events.providerEventId,
  startsAt: events.startsAt,
  homeTeamKey: events.homeTeamKey,
  awayTeamKey: events.awayTeamKey,
  homeTeam: events.homeTeam,
  awayTeam: events.awayTeam,
  homeScore: events.homeScore,
  awayScore: events.awayScore,
} as const;

function teamKeyMatch(teamKey: string) {
  return or(eq(events.homeTeamKey, teamKey), eq(events.awayTeamKey, teamKey));
}

/** Finished events involving one team, newest first. */
export async function fetchFinishedGamesForTeam(
  db: DB,
  teamKey: string,
  limit = 20,
): Promise<FinishedGameRow[]> {
  return db
    .select(finishedGameColumns)
    .from(events)
    .where(and(eq(events.status, FINISHED), teamKeyMatch(teamKey)))
    .orderBy(desc(events.startsAt))
    .limit(limit);
}

/**
 * Finished events involving one team WITH Mantua's opening line joined on
 * (home moneyline market), newest first. Left join — games without a
 * minted market still count as history, they just carry no line.
 */
export async function fetchFinishedGamesWithOpening(
  db: DB,
  teamKey: string,
  limit = 50,
): Promise<FinishedGameRow[]> {
  return db
    .select({ ...finishedGameColumns, homeOpeningProbability: markets.openingProbability })
    .from(events)
    .leftJoin(
      markets,
      and(
        eq(markets.eventId, events.id),
        eq(markets.marketType, "moneyline"),
        eq(markets.outcomeIndex, 0),
      ),
    )
    .where(and(eq(events.status, FINISHED), teamKeyMatch(teamKey)))
    .orderBy(desc(events.startsAt))
    .limit(limit);
}

/** Recent completed games for a team (S-008 "recent games"). */
export async function getRecentGames(
  db: DB,
  teamKey: string,
  limit = 10,
): Promise<HistoryResult<TeamGameSummary[]>> {
  const rows = await fetchFinishedGamesForTeam(db, teamKey, limit);
  const games = summarizeTeamGames(teamKey, rows);
  if (games.length === 0) {
    return insufficientData(`no completed games for ${teamKey} in the canonical events table`);
  }
  return okResult(games);
}

/** Head-to-head between two team keys (S-008). */
export async function getHeadToHead(
  db: DB,
  teamAKey: string,
  teamBKey: string,
  limit = 20,
): Promise<HistoryResult<HeadToHeadSummary>> {
  const rows = await db
    .select(finishedGameColumns)
    .from(events)
    .where(
      and(
        eq(events.status, FINISHED),
        or(
          and(eq(events.homeTeamKey, teamAKey), eq(events.awayTeamKey, teamBKey)),
          and(eq(events.homeTeamKey, teamBKey), eq(events.awayTeamKey, teamAKey)),
        ),
      ),
    )
    .orderBy(desc(events.startsAt))
    .limit(limit);
  return computeHeadToHead(teamAKey, teamBKey, rows);
}

/** Home/away splits (S-008). */
export async function getHomeAwaySplits(
  db: DB,
  teamKey: string,
  limit = 50,
): Promise<HistoryResult<HomeAwaySplits>> {
  const rows = await fetchFinishedGamesForTeam(db, teamKey, limit);
  return computeHomeAwaySplits(teamKey, rows);
}

/** Situational trends (S-008) — includes favorite/underdog off our lines. */
export async function getSituationalTrends(
  db: DB,
  teamKey: string,
  limit = 50,
): Promise<HistoryResult<SituationalTrends>> {
  const rows = await fetchFinishedGamesWithOpening(db, teamKey, limit);
  return computeSituationalTrends(teamKey, rows);
}

// ─── Standings (S-006 read path) ─────────────────────────────────────────────

export interface StandingsRow {
  teamKey: string;
  teamName: string;
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
  /** Unix seconds of the snapshot's last refresh — the staleness signal. */
  updatedAt: number;
}

/** Current standings snapshot for a league (+ optional season filter). */
export async function getStandings(
  db: DB,
  leagueSlug: string,
  season?: string,
): Promise<HistoryResult<StandingsRow[]>> {
  const rows = await db
    .select({
      teamKey: teams.key,
      teamName: teams.name,
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
      updatedAt: teamRecords.updatedAt,
    })
    .from(teamRecords)
    .innerJoin(teams, eq(teamRecords.teamId, teams.id))
    .innerJoin(leagues, eq(teams.leagueId, leagues.id))
    .where(
      season === undefined
        ? eq(leagues.slug, leagueSlug)
        : and(eq(leagues.slug, leagueSlug), eq(teamRecords.season, season)),
    )
    .orderBy(desc(teamRecords.season), asc(teamRecords.divisionRank), desc(teamRecords.wins));
  if (rows.length === 0) {
    return insufficientData(
      `no standings snapshot for ${leagueSlug}${season ? ` season ${season}` : ""} — team_records not ingested yet`,
    );
  }
  return okResult(
    rows.map((r) => ({ ...r, updatedAt: Math.floor(r.updatedAt.getTime() / 1000) })),
  );
}

// ─── Mantua market price history (S-008 market side) ─────────────────────────

export interface PriceSeriesPoint {
  /** Unix seconds. */
  t: number;
  /** Implied YES probability, 0–1. */
  p: number;
  source: string;
}

/** The recorded price series for one market, oldest first. */
export async function getMarketPriceHistory(
  db: DB,
  marketId: string,
  limit = 500,
): Promise<HistoryResult<PriceSeriesPoint[]>> {
  const rows = await db
    .select({
      impliedProbability: marketPrices.impliedProbability,
      source: marketPrices.source,
      capturedAt: marketPrices.capturedAt,
    })
    .from(marketPrices)
    .where(eq(marketPrices.marketId, marketId))
    .orderBy(desc(marketPrices.capturedAt))
    .limit(limit);
  if (rows.length === 0) {
    return insufficientData(`no recorded prices for market ${marketId}`);
  }
  return okResult(
    rows
      .reverse()
      .map((r) => ({
        t: Math.floor(r.capturedAt.getTime() / 1000),
        p: Number(r.impliedProbability),
        source: r.source,
      })),
  );
}

export interface TeamMarketPricePoint extends PriceSeriesPoint {
  marketId: string;
  providerEventId: string;
  /** Which side of the game the market's YES prices: 0 home, 1 away. */
  outcomeIndex: number;
  /** Probability from the TEAM's perspective (complement for away rows
   *  of home markets and vice versa is NOT applied — `p` is the market's
   *  own YES probability; `teamIsYes` says whether that is this team). */
  teamIsYes: boolean;
}

/**
 * Historical Mantua market prices for a team across its events — the
 * market_prices series joined through markets → events on the team key.
 * Oldest first, bounded.
 */
export async function getTeamMarketPriceHistory(
  db: DB,
  teamKey: string,
  limit = 500,
): Promise<HistoryResult<TeamMarketPricePoint[]>> {
  const rows = await db
    .select({
      marketId: markets.marketId,
      outcomeIndex: markets.outcomeIndex,
      providerEventId: events.providerEventId,
      homeTeamKey: events.homeTeamKey,
      impliedProbability: marketPrices.impliedProbability,
      source: marketPrices.source,
      capturedAt: marketPrices.capturedAt,
    })
    .from(marketPrices)
    .innerJoin(markets, eq(marketPrices.marketId, markets.marketId))
    .innerJoin(events, eq(markets.eventId, events.id))
    .where(and(teamKeyMatch(teamKey), sql`${markets.marketType} = 'moneyline'`))
    .orderBy(desc(marketPrices.capturedAt))
    .limit(limit);
  if (rows.length === 0) {
    return insufficientData(`no recorded Mantua market prices for team ${teamKey}`);
  }
  return okResult(
    rows.reverse().map((r) => ({
      marketId: r.marketId,
      providerEventId: r.providerEventId,
      outcomeIndex: r.outcomeIndex,
      teamIsYes:
        r.outcomeIndex === 0 ? r.homeTeamKey === teamKey : r.homeTeamKey !== teamKey,
      t: Math.floor(r.capturedAt.getTime() / 1000),
      p: Number(r.impliedProbability),
      source: r.source,
    })),
  );
}
