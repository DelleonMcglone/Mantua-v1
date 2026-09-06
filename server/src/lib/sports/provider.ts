/**
 * B3-001 — the `SportsDataProvider` boundary.
 *
 * Every provider sits behind this interface and no feature code calls a
 * provider directly. That indirection is the mitigation for the pivot plan's
 * Risk 1: ESPN retired its public developer API in 2014, and
 * `site.api.espn.com` is the undocumented JSON backend behind espn.com — no
 * contract, no SLA, no deprecation notice. When it changes shape or goes away,
 * the blast radius is one adapter file.
 *
 * It is also what makes DM-107's disagreement detection possible: two
 * providers can only be compared if they return the same normalized type.
 *
 * Spec: `docs/specs/market-lifecycle.md` §3.1, §3.5. Decisions: DM-105
 * (NFL + WNBA), DM-107 (ESPN primary).
 */

/** Leagues a provider can be asked for. Matches `SportId` on the client. */
export type LeagueSlug = "nfl" | "wnba";

/**
 * Where an event is in its life, as the *provider* sees it. Deliberately
 * narrower than the on-chain `EventState`: a provider reports observable
 * reality, not market policy. Mapping one to the other is the ingest worker's
 * job, not the adapter's.
 */
export type ProviderEventStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "postponed"
  | "cancelled"
  /** Provider returned a status string we do not recognise. Never guessed at. */
  | "unknown";

export interface ProviderTeam {
  /** The provider's own team id. */
  providerId: string;
  /**
   * Provider-agnostic key derived from the abbreviation, e.g. `nfl:KC`.
   * Two providers naming the same team must produce the same key — this is
   * what lets B3-008 compare them (B3-004).
   */
  key: string;
  name: string;
  abbreviation: string;
  /** Team mark URL, if the provider supplies one. */
  logo?: string;
  /** Season win–loss summary, e.g. "31-7", if the provider supplies one. */
  record?: string;
}

/**
 * One game, normalized. This is the shape the `events` table stores and the
 * only shape feature code sees.
 */
export interface ProviderEvent {
  /** The provider's event id. Load-bearing: the market id hashes it (B0-004). */
  providerEventId: string;
  league: LeagueSlug;
  /** Scheduled start, as a Unix timestamp in seconds. */
  startsAt: number;
  status: ProviderEventStatus;
  home: ProviderTeam;
  away: ProviderTeam;
  homeScore?: number;
  awayScore?: number;
  /**
   * Home win probability in bps, if the provider publishes odds. Used to seed
   * the opening pool price (B1-009); absent means fall back to 5000.
   */
  homeWinProbabilityBps?: number;
}

/** A provider's answer, plus how much to trust its freshness. */
export interface ProviderSlate {
  provider: string;
  league: LeagueSlug;
  events: ProviderEvent[];
  /**
   * True when the response came from a degraded path — a cached value served
   * past its TTL because the upstream failed, or an open circuit breaker.
   * Callers must surface this rather than treat it as live (B3-003), and the
   * resolution service must never settle a market on delayed data.
   */
  delayed: boolean;
  fetchedAt: number;
}

// ─── Reference-data capabilities (S-003) ────────────────────────────────────
//
// A licensed provider (Sportradar) supplies more than the slate: the league
// hierarchy, team rosters, and injury reports that fill the canonical
// `teams`/`players`/`injuries` tables. The capabilities are OPTIONAL methods
// so the ESPN prototyping adapter keeps its exact existing surface — a
// provider that does not implement one simply contributes nothing to that
// table, and the ingest worker skips the pass.

/** A rostered player, normalized. Maps onto the `players` table (B3-004). */
export interface ProviderPlayer {
  /** The provider's own player id. Keyed unique with `provider` in the DB. */
  providerPlayerId: string;
  name: string;
  /** Provider-agnostic key of the player's team (see `teamKey`). */
  teamKey: string;
  position?: string;
  jerseyNumber?: number;
  /** Collapsed onto the `players.status` convention. */
  status: "active" | "inactive" | "retired";
}

/** Injury designations the `injuries.status` column models. */
export type ProviderInjuryStatus =
  | "out"
  | "doubtful"
  | "questionable"
  | "probable"
  | "day_to_day"
  | "ir";

/**
 * One injury report line. A player's *current* status is the latest open row
 * in the `injuries` table (`resolvedAt` null); the ingest worker turns a
 * stream of these into open/resolve transitions, the adapter only reports.
 */
export interface ProviderInjuryReport {
  providerPlayerId: string;
  playerName: string;
  /** Provider-agnostic key of the reporting team, when known. */
  teamKey?: string;
  status: ProviderInjuryStatus;
  /** e.g. "Hamstring", "Concussion". */
  description?: string;
  /** Provider's own last-updated stamp, Unix seconds, for staleness checks. */
  providerUpdatedAt?: number;
}

/**
 * One play from a play-by-play feed (S-005 / task 041). Maps onto the
 * `game_plays` table: the provider's `sequence` is the append cursor —
 * Sportradar documents it as an epoch-milliseconds-scale number
 * (football/reference/nfl-play-by-play), which is why the column is bigint.
 */
export interface ProviderPlay {
  /** Provider's monotonically increasing play ordering within the game. */
  sequence: number;
  /** Quarter/period number, when the feed nests plays under periods. */
  period?: number;
  /** Game clock at the play, provider format (e.g. "12:34"). */
  clock?: string;
  /** Provider play-type slug, e.g. "rush", "pass", "kickoff". */
  playType?: string;
  description?: string;
  /** Provider-agnostic key of the team in possession at the play's start. */
  teamKey?: string;
  scoringPlay: boolean;
  /** Running score AFTER the play, when the feed reports it. */
  homeScore?: number;
  awayScore?: number;
  /** Provider extras that don't earn columns (wall clock, end-of-play
   *  possession, …) — persisted into `game_plays.detail`. */
  detail?: Record<string, unknown>;
}

/**
 * One team's standings line (S-006 / task 041). Maps onto `team_records`.
 * Field semantics follow Sportradar's postgame-standings reference
 * (football/reference/nfl-postgame-standings); other providers must
 * normalise onto the same meanings, never invent.
 */
export interface ProviderTeamStanding {
  providerTeamId: string;
  /** Provider-agnostic team key (see `teamKey`). */
  teamKey: string;
  /** Season label, e.g. "2026". */
  season: string;
  /** Collapsed onto the `team_records.season_type` convention. */
  seasonType: "regular" | "preseason" | "postseason";
  wins: number;
  losses: number;
  ties: number;
  divisionRank?: number;
  conferenceRank?: number;
  pointsFor?: number;
  pointsAgainst?: number;
  /** Streak notation, e.g. "W3", "L1". */
  streak?: string;
  /** Home/away win–loss strings, e.g. "5-2". */
  homeRecord?: string;
  awayRecord?: string;
  /** Flat numeric season aggregates the feed publishes (win_pct, split
   *  records, …) — persisted into `team_records.stats` for the
   *  `teamSeasonStats` reader. */
  stats: Record<string, number>;
}

/** Shared envelope for reference-data feeds — same trust flags as a slate. */
export interface ProviderFeed<T> {
  provider: string;
  league: LeagueSlug;
  items: T[];
  /** Same meaning as `ProviderSlate.delayed` — degraded path, do not trust as live. */
  delayed: boolean;
  fetchedAt: number;
}

export interface SportsDataProvider {
  /** Short stable id, stored on `events.provider`. */
  readonly name: string;

  /** Leagues this adapter can serve. */
  readonly leagues: readonly LeagueSlug[];

  /** Today's slate for a league. */
  getSlate(league: LeagueSlug): Promise<ProviderSlate>;

  /**
   * One event by the provider's id, for live polling and final capture.
   * Resolves `null` when the provider does not know it — distinct from a
   * fetch failure, which throws.
   */
  getEvent(league: LeagueSlug, providerEventId: string): Promise<ProviderEvent | null>;

  // ── Optional reference-data capabilities ──────────────────────────────
  // Absent method = capability not offered. The ingest worker feature-tests
  // with `typeof provider.getTeams === "function"` and skips otherwise, so
  // adding these changed no existing adapter or caller.

  /** Every team in the league (hierarchy feed). */
  getTeams?(league: LeagueSlug): Promise<ProviderFeed<ProviderTeam>>;

  /** Full roster for one team, by the provider's team id. */
  getRoster?(league: LeagueSlug, providerTeamId: string): Promise<ProviderFeed<ProviderPlayer>>;

  /** Current injury reports across the league. */
  getInjuries?(league: LeagueSlug): Promise<ProviderFeed<ProviderInjuryReport>>;

  /**
   * Play-by-play for one game, by the provider's event id (task 041).
   * Quota rule: the ingest worker calls this only for LIVE and just-finished
   * games on a bounded per-tick rotation — never per user request.
   */
  getPlayByPlay?(
    league: LeagueSlug,
    providerEventId: string,
  ): Promise<ProviderFeed<ProviderPlay>>;

  /** Season standings/records across the league (task 041). */
  getStandings?(league: LeagueSlug): Promise<ProviderFeed<ProviderTeamStanding>>;
}

/** Thrown when a provider is reachable but its response is unusable. */
export class ProviderShapeError extends Error {}

/** Thrown when a provider cannot be reached at all. */
export class ProviderUnavailableError extends Error {}

/**
 * Provider-agnostic team key (B3-004).
 *
 * Built from the league and the team abbreviation rather than the provider's
 * numeric id, because those ids differ per provider while abbreviations are
 * effectively standard. Namespaced by league so a shared abbreviation across
 * sports cannot collide.
 */
export function teamKey(league: LeagueSlug, abbreviation: string): string {
  return `${league}:${abbreviation.trim().toUpperCase()}`;
}

/** Whether a status means the game will not be played (spec §3.7 void path). */
export function isVoidStatus(status: ProviderEventStatus): boolean {
  return status === "postponed" || status === "cancelled";
}

/**
 * Whether a status is safe to resolve a market on.
 *
 * Only `final` qualifies. `unknown` explicitly does not: an unrecognised status
 * string is missing information, and spec §3.5 requires that absence of data
 * never settle a market.
 */
export function isSettleable(status: ProviderEventStatus): boolean {
  return status === "final";
}
