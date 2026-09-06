/**
 * B3-005 / B3-006 — the ingest worker and the market generator.
 *
 * Three passes, deliberately separate because they have different failure
 * consequences:
 *
 *  - **slate refresh** — new games appear. Getting this wrong delays a market.
 *  - **live polling** — scores move. Getting this wrong shows stale numbers.
 *  - **final capture** — a game ends. Getting this wrong settles a market
 *    incorrectly, which is unrecoverable on-chain.
 *
 * Only the third is dangerous, so it is the one that refuses to act on
 * anything less than certainty: a `delayed` slate never produces a final, and
 * an unrecognised status never counts as one (spec §3.5).
 *
 * The generator is pure planning: it decides which markets *should* exist and
 * returns them. It does not sign anything. Deployment of the market contracts
 * is a separate, explicitly-authorised step, and keeping the two apart means a
 * bug in slate parsing cannot mint markets.
 */

import { logger } from "../logger.ts";
import { computeMarketId, type MarketType } from "../market-id.ts";
import { probabilityToPrice } from "../probability.ts";
import {
  type LeagueSlug,
  type ProviderEvent,
  type ProviderInjuryReport,
  type ProviderPlay,
  type ProviderTeamStanding,
  type SportsDataProvider,
  isSettleable,
  isVoidStatus,
} from "./provider.ts";

/** A market the generator says should exist for a game. */
export interface PlannedMarket {
  marketId: `0x${string}`;
  providerEventId: string;
  league: LeagueSlug;
  marketType: MarketType;
  /** 0 = home, 1 = away. Fixed by the canonical event row (B0-004). */
  outcomeIndex: number;
  /** Label for the YES token of this outcome. */
  label: string;
  kickoffTimestamp: number;
  /** Opening implied probability, 0–1, for seeding the pool (B1-009). */
  openingProbability: number;
}

/**
 * Plan the market set for one event.
 *
 * DM-106 is moneyline only, which for a binary pair means **two** markets per
 * game — one where YES is "home wins", one where YES is "away wins". They are
 * distinct markets with distinct ids and distinct pools, not two views of one.
 *
 * Games already started, finished, or called off produce nothing: `MarketFactory`
 * rejects a kickoff at or before now (a market born frozen could never trade),
 * so planning one would only generate a guaranteed revert.
 */
export function planMarkets(
  event: ProviderEvent,
  nowSeconds: number,
  chainId?: number,
): PlannedMarket[] {
  if (event.status !== "scheduled") return [];
  if (event.startsAt <= nowSeconds) return [];

  const homeProb =
    event.homeWinProbabilityBps !== undefined
      ? probabilityToPrice(event.homeWinProbabilityBps / 10_000)
      : 0.5;

  const sides: { outcomeIndex: number; label: string; probability: number }[] = [
    { outcomeIndex: 0, label: `${event.home.abbreviation} to win`, probability: homeProb },
    // The complement, so the two markets price consistently at open rather than
    // both starting at whatever the provider said about the home side.
    { outcomeIndex: 1, label: `${event.away.abbreviation} to win`, probability: 1 - homeProb },
  ];

  return sides.map((side) => ({
    marketId: computeMarketId({
      providerEventId: event.providerEventId,
      marketType: "moneyline",
      outcomeIndex: side.outcomeIndex,
      ...(chainId !== undefined ? { chainId } : {}),
    }),
    providerEventId: event.providerEventId,
    league: event.league,
    marketType: "moneyline" as const,
    outcomeIndex: side.outcomeIndex,
    label: side.label,
    kickoffTimestamp: event.startsAt,
    openingProbability: probabilityToPrice(side.probability),
  }));
}

/** Plan every market for a slate. Deterministic, so re-running is a no-op. */
export function planSlate(
  events: readonly ProviderEvent[],
  nowSeconds: number,
  chainId?: number,
): PlannedMarket[] {
  return events.flatMap((e) => planMarkets(e, nowSeconds, chainId));
}

// ─── Plan from canonical events (task 046 / P-002) ──────────────────────────

/** A persisted `events` row as the canonical planner consumes it. */
export interface CanonicalPlannableEvent {
  providerEventId: string;
  /** scheduled | in_progress | final | postponed | cancelled */
  status: string;
  /** Kickoff, Unix seconds. */
  startsAtSeconds: number;
  homeTeamKey: string | null;
  awayTeamKey: string | null;
}

export interface CanonicalPlanResult {
  planned: PlannedMarket[];
  /** Canonical rows the current feed no longer carries — a market needs the
   *  feed's labels/odds to open, so these wait for the feed to return. */
  skippedNoFeed: number;
  /** Feed rows whose home/away contradicts the stored row — the same
   *  corruption the store's upsert guard refuses; never plan from it. */
  skippedSideMismatch: number;
}

/**
 * The 041 architecture rule applied to market planning: **consumers read
 * the DB, providers only feed ingestion.** The planning universe is the
 * persisted canonical `events` rows — a game that ingestion has not
 * persisted can never mint a market, and the stored row's home/away
 * assignment (which fixes `outcomeIndex`, and which the store's
 * side-conflict guard makes immutable) is the binding the market id hashes.
 * The same tick's feed contributes only what the schema doesn't persist:
 * team abbreviations for the on-chain label and the opening probability.
 *
 * Deterministic over the same rows + feed, so re-running stays a no-op
 * through `createMarketIfAbsent` exactly as before.
 */
export function planCanonicalMarkets(
  canonical: readonly CanonicalPlannableEvent[],
  feedByEventId: ReadonlyMap<string, ProviderEvent>,
  nowSeconds: number,
  chainId?: number,
): CanonicalPlanResult {
  const result: CanonicalPlanResult = { planned: [], skippedNoFeed: 0, skippedSideMismatch: 0 };
  for (const row of canonical) {
    // Same window as planMarkets: only scheduled, pre-kickoff games open.
    if (row.status !== "scheduled" || row.startsAtSeconds <= nowSeconds) continue;
    const feed = feedByEventId.get(row.providerEventId);
    if (!feed) {
      result.skippedNoFeed += 1;
      continue;
    }
    if (
      (row.homeTeamKey !== null && feed.home.key !== row.homeTeamKey) ||
      (row.awayTeamKey !== null && feed.away.key !== row.awayTeamKey)
    ) {
      result.skippedSideMismatch += 1;
      continue;
    }
    // Identity and clock from the canonical row; labels/odds from the feed.
    result.planned.push(
      ...planMarkets(
        { ...feed, status: "scheduled", startsAt: row.startsAtSeconds },
        nowSeconds,
        chainId,
      ),
    );
  }
  return result;
}

/** What the resolution service should do about one event. */
export type SettlementAction =
  | { kind: "wait"; reason: string }
  | { kind: "void"; providerEventId: string }
  | { kind: "resolve"; providerEventId: string; winningOutcomeIndex: number };

/**
 * Decide the settlement action for an event.
 *
 * Every branch that is not a certain outcome returns `wait`. That asymmetry is
 * the point: waiting costs a delay, while resolving wrongly is permanent
 * (spec §3.5, §4).
 *
 * @param delayed True when the data came from a degraded path. A delayed
 *        response can be arbitrarily old, so it can report a game as still in
 *        progress that has in fact finished — or, worse, carry a stale score.
 *        Never settle on it.
 */
export function decideSettlement(event: ProviderEvent, delayed: boolean): SettlementAction {
  if (isVoidStatus(event.status)) {
    return { kind: "void", providerEventId: event.providerEventId };
  }

  if (delayed) {
    return { kind: "wait", reason: "provider data is delayed; refusing to settle" };
  }

  if (!isSettleable(event.status)) {
    return { kind: "wait", reason: `status is ${event.status}, not final` };
  }

  if (event.homeScore === undefined || event.awayScore === undefined) {
    return { kind: "wait", reason: "final without both scores" };
  }

  if (event.homeScore === event.awayScore) {
    // A tie satisfies neither "home wins" nor "away wins", so both binary
    // markets void rather than one of them paying out arbitrarily. NFL ties are
    // rare but real; WNBA cannot tie.
    return { kind: "void", providerEventId: event.providerEventId };
  }

  return {
    kind: "resolve",
    providerEventId: event.providerEventId,
    winningOutcomeIndex: event.homeScore > event.awayScore ? 0 : 1,
  };
}

export interface SlateRefreshResult {
  league: LeagueSlug;
  provider: string;
  delayed: boolean;
  /** The normalized events, for persistence — one fetch serves both passes. */
  events: ProviderEvent[];
  marketsPlanned: PlannedMarket[];
}

/**
 * B3-005 slate refresh: read a league's slate and plan its markets.
 *
 * A `delayed` slate still plans markets — creating a market late is harmless
 * and idempotent, and the alternative is a market never existing because the
 * provider wobbled once. The flag is propagated so callers know.
 */
export async function refreshSlate(
  provider: SportsDataProvider,
  league: LeagueSlug,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  chainId?: number,
): Promise<SlateRefreshResult> {
  const slate = await provider.getSlate(league);
  const marketsPlanned = planSlate(slate.events, nowSeconds, chainId);

  if (slate.delayed) {
    logger.warn({ league, provider: slate.provider }, "sports: slate is delayed");
  }

  recordFeedPoll("slate", league, slate.provider, slate.delayed);

  return {
    league,
    provider: slate.provider,
    delayed: slate.delayed,
    events: slate.events,
    marketsPlanned,
  };
}

// ─── Per-feed freshness (S-003) ─────────────────────────────────────────────
//
// The `events` table already carries `last_polled_at` per row; teams and
// players carry `updated_at`. What the schema deliberately does NOT carry is
// per-FEED bookkeeping — that is process state, tracked here in the same
// spirit as the resilience layer's breaker snapshots ("extend the pattern,
// not the schema"). `lastGoodAt` only advances on a non-delayed fetch, so
// `lastPolledAt − lastGoodAt` is exactly how long a feed has been limping.

export type FeedName = "slate" | "teams" | "rosters" | "injuries" | "standings" | "pbp";

export interface FeedFreshness {
  provider: string;
  /** Last attempt that returned at all (fresh OR stale-grace). */
  lastPolledAt: number;
  /** Last genuinely fresh (non-delayed) result. */
  lastGoodAt: number | null;
  delayed: boolean;
}

const feedFreshness = new Map<string, FeedFreshness>();

export function recordFeedPoll(
  feed: FeedName,
  league: LeagueSlug,
  provider: string,
  delayed: boolean,
  now: number = Date.now(),
): void {
  const key = `${league}:${feed}`;
  const prev = feedFreshness.get(key);
  feedFreshness.set(key, {
    provider,
    lastPolledAt: now,
    lastGoodAt: delayed ? (prev?.lastGoodAt ?? null) : now,
    delayed,
  });
}

/** Snapshot for health endpoints and the sync tick's report. */
export function feedFreshnessSnapshot(): Record<string, FeedFreshness> {
  return Object.fromEntries(feedFreshness.entries());
}

// ─── Injury open/resolve planning (S-003) ───────────────────────────────────

/** An open injury row as the planner sees it (store supplies the real rows). */
export interface OpenInjuryRow {
  id: string;
  providerPlayerId: string;
  status: string;
  description: string | null;
}

/** What the store should do to the `injuries` table for one feed read. */
export interface InjuryTransitionPlan {
  /** Row ids whose report is over — player recovered or status changed. */
  resolve: string[];
  /** New reports to insert as open rows. */
  open: ProviderInjuryReport[];
  /** Row ids unchanged by this read (freshness bump only). */
  touch: string[];
}

/**
 * Decide open/resolve transitions from the current feed against the open
 * rows. Pure, so the rules are testable without a database:
 *
 *  - report with no open row            → open a new row
 *  - report matching an open row        → touch (same status + description)
 *  - report differing from the open row → resolve old, open new (history is
 *    append-only; a status change is a new report, per the schema's comment
 *    that a player's current status is the LATEST open row)
 *  - open row with no report            → resolve (the player dropped off
 *    the injury report, i.e. returned)
 *
 * `delayed` feeds plan nothing: a stale injury list must not "recover" every
 * player just because the fetch limped (same asymmetry as settlement — a
 * wrong resolve is worse than a late one).
 */
export function planInjuryTransitions(
  openRows: readonly OpenInjuryRow[],
  reports: readonly ProviderInjuryReport[],
  delayed: boolean,
): InjuryTransitionPlan {
  if (delayed) return { resolve: [], open: [], touch: [] };

  const plan: InjuryTransitionPlan = { resolve: [], open: [], touch: [] };
  const openByPlayer = new Map<string, OpenInjuryRow[]>();
  for (const row of openRows) {
    const list = openByPlayer.get(row.providerPlayerId) ?? [];
    list.push(row);
    openByPlayer.set(row.providerPlayerId, list);
  }

  const reported = new Set<string>();
  for (const report of reports) {
    // One report per player per read: the adapter already picked the latest.
    if (reported.has(report.providerPlayerId)) continue;
    reported.add(report.providerPlayerId);

    const open = openByPlayer.get(report.providerPlayerId) ?? [];
    const match = open.find(
      (row) =>
        row.status === report.status && (row.description ?? null) === (report.description ?? null),
    );
    if (match) {
      plan.touch.push(match.id);
      // Duplicated/superseded open rows for the same player resolve — the
      // "current status is the latest open row" convention wants one.
      for (const row of open) if (row.id !== match.id) plan.resolve.push(row.id);
    } else {
      for (const row of open) plan.resolve.push(row.id);
      plan.open.push(report);
    }
  }

  for (const [playerId, rows] of openByPlayer) {
    if (reported.has(playerId)) continue;
    for (const row of rows) plan.resolve.push(row.id);
  }

  return plan;
}

// ─── Play-by-play target selection (task 041) ───────────────────────────────

/** An event as the pbp planner sees it (store supplies the real rows). */
export interface PbpCandidateRow {
  providerEventId: string;
  status: string;
  /** Scheduled start, Unix seconds. */
  startsAt: number;
}

/** How long after kickoff a `final` game still counts as "just finished" and
 *  earns a closing pbp fetch. Sized to cover the gap between sync ticks so a
 *  game that ended between ticks still gets its full log captured once. */
export const PBP_FINAL_GRACE_SECONDS = 36 * 3_600;

/**
 * Which games this tick spends pbp quota on. Pure, so the quota rule is a
 * tested invariant rather than a hope:
 *
 *  - LIVE (`in_progress`) games always qualify — their play log is growing.
 *  - `final` games qualify only inside the just-finished grace window (one
 *    closing capture; the append-only upsert makes the re-fetch a no-op).
 *  - scheduled / postponed / cancelled games NEVER qualify — a game with no
 *    plays yet (or ever) must not burn trial quota.
 *  - the result is capped at `maxGames` per tick, live games first (oldest
 *    kickoff first — the one closest to ending has the most complete log),
 *    then just-finished games newest-kickoff-first.
 */
export function selectPbpTargets(
  candidates: readonly PbpCandidateRow[],
  nowSeconds: number,
  maxGames = 2,
  finalGraceSeconds: number = PBP_FINAL_GRACE_SECONDS,
): PbpCandidateRow[] {
  if (maxGames <= 0) return [];
  const live = candidates
    .filter((c) => c.status === "in_progress")
    .sort((a, b) => a.startsAt - b.startsAt);
  const justFinished = candidates
    .filter((c) => c.status === "final" && c.startsAt >= nowSeconds - finalGraceSeconds)
    .sort((a, b) => b.startsAt - a.startsAt);
  return [...live, ...justFinished].slice(0, maxGames);
}

/** A `game_plays` row as planned — store.ts turns these into inserts. */
export interface PlannedGamePlayRow {
  eventId: string;
  provider: string;
  sequence: number;
  period: number | null;
  clock: string | null;
  playType: string | null;
  description: string | null;
  teamKey: string | null;
  scoringPlay: boolean;
  homeScore: number | null;
  awayScore: number | null;
  detail: Record<string, unknown>;
}

/**
 * Feed plays → insert rows for one game. Pure: collapses duplicate provider
 * sequences (last occurrence wins — same rule as the injuries planner) so
 * the batch itself can never violate the (event, provider, sequence) unique,
 * and re-planning the same feed yields byte-identical rows — which is what
 * makes the append-only `onConflictDoNothing` re-ingest a true no-op.
 */
export function planGamePlayRows(
  eventId: string,
  provider: string,
  plays: readonly ProviderPlay[],
): PlannedGamePlayRow[] {
  const bySequence = new Map<number, PlannedGamePlayRow>();
  for (const p of plays) {
    bySequence.set(p.sequence, {
      eventId,
      provider,
      sequence: p.sequence,
      period: p.period ?? null,
      clock: p.clock ?? null,
      playType: p.playType ?? null,
      description: p.description ?? null,
      teamKey: p.teamKey ?? null,
      scoringPlay: p.scoringPlay,
      homeScore: p.homeScore ?? null,
      awayScore: p.awayScore ?? null,
      detail: p.detail ?? {},
    });
  }
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

// ─── Standings → team_records planning (task 041) ───────────────────────────

/** A `team_records` upsert as planned — store.ts writes it. */
export interface PlannedTeamRecordRow {
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
  stats: Record<string, number>;
}

export interface TeamRecordPlan {
  rows: PlannedTeamRecordRow[];
  /** Standings lines for teams not in the canonical `teams` table yet —
   *  healed by the next hierarchy pass, so skipping (not failing) is right. */
  skippedUnknownTeams: number;
}

/**
 * Standings feed → `team_records` upsert rows. Pure. A `delayed` feed plans
 * NOTHING — a stale standings snapshot must not overwrite a fresher one
 * (same asymmetry as the injuries planner).
 */
export function planTeamRecordRows(
  standings: readonly ProviderTeamStanding[],
  teamIdsByKey: ReadonlyMap<string, string>,
  delayed: boolean,
): TeamRecordPlan {
  if (delayed) return { rows: [], skippedUnknownTeams: 0 };
  const plan: TeamRecordPlan = { rows: [], skippedUnknownTeams: 0 };
  for (const s of standings) {
    const teamId = teamIdsByKey.get(s.teamKey);
    if (teamId === undefined) {
      plan.skippedUnknownTeams += 1;
      continue;
    }
    plan.rows.push({
      teamId,
      season: s.season,
      seasonType: s.seasonType,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      divisionRank: s.divisionRank ?? null,
      conferenceRank: s.conferenceRank ?? null,
      pointsFor: s.pointsFor ?? null,
      pointsAgainst: s.pointsAgainst ?? null,
      streak: s.streak ?? null,
      homeRecord: s.homeRecord ?? null,
      awayRecord: s.awayRecord ?? null,
      stats: s.stats,
    });
  }
  return plan;
}

// The effectful half of the reference-data pass — `refreshReferenceData` —
// lives in store.ts with the other DB writers, so this module stays free of
// runtime DB imports and its planners stay unit-testable under the stub env.
