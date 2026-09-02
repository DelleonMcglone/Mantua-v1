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
