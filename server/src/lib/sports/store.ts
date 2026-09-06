/**
 * B3-004 — persist normalized provider events into the canonical `events`
 * rows, and keep the sport/league catalog rows they hang off.
 *
 * Everything here is an upsert keyed on `(provider, provider_event_id)` — the
 * unique constraint the schema carries precisely so that a slate refresh is
 * idempotent. Re-running the worker over the same slate updates timestamps and
 * scores; it can never duplicate a game (spec §3.1).
 *
 * One rule is enforced at this layer rather than left to callers: **home and
 * away are written once and never flipped by an update.** The market id's
 * outcome index is derived from that assignment (docs/specs/market-id.md), so
 * a provider reordering teams mid-season must not silently invert what an
 * existing market's YES token means. If a provider ever *does* swap sides for
 * a known event, that is corruption to escalate, not data to apply.
 */

import { eq, and, isNull, or, asc, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import {
  events,
  injuries,
  leagues,
  markets,
  players,
  sports,
  teams,
} from "../../db/schema/index.ts";
import type { OnChainMarketDetail } from "./markets-onchain.ts";
import { logger } from "../logger.ts";
import type {
  LeagueSlug,
  ProviderEvent,
  ProviderPlayer,
  ProviderTeam,
  SportsDataProvider,
} from "./provider.ts";
import { planInjuryTransitions, recordFeedPoll, type InjuryTransitionPlan } from "./ingest.ts";

/** The catalog the covered leagues hang off. Mirrors DM-105. */
const CATALOG: Record<
  LeagueSlug,
  { sportSlug: string; sportName: string; leagueName: string; providerKey: string }
> = {
  nfl: {
    sportSlug: "football",
    sportName: "Football",
    leagueName: "NFL",
    providerKey: "football/nfl",
  },
  wnba: {
    sportSlug: "basketball",
    sportName: "Basketball",
    leagueName: "WNBA",
    providerKey: "basketball/wnba",
  },
};

/** Ensure the sport + league rows exist; return the league id. */
export async function ensureLeague(db: DB, slug: LeagueSlug): Promise<string> {
  const entry = CATALOG[slug];

  const existing = await db.query.leagues.findFirst({ where: eq(leagues.slug, slug) });
  if (existing) return existing.id;

  let sport = await db.query.sports.findFirst({ where: eq(sports.slug, entry.sportSlug) });
  sport ??= (
    await db
      .insert(sports)
      .values({ slug: entry.sportSlug, name: entry.sportName })
      .onConflictDoNothing()
      .returning()
  ).at(0);
  if (!sport) {
    // Conflict raced us — someone else inserted it between the check and now.
    sport = await db.query.sports.findFirst({ where: eq(sports.slug, entry.sportSlug) });
  }
  if (!sport) throw new Error(`could not ensure sport row for ${entry.sportSlug}`);

  const inserted = await db
    .insert(leagues)
    .values({
      sportId: sport.id,
      slug,
      name: entry.leagueName,
      coverage: "launch",
      providerKey: entry.providerKey,
    })
    .onConflictDoNothing()
    .returning();

  const league =
    inserted.at(0) ?? (await db.query.leagues.findFirst({ where: eq(leagues.slug, slug) }));
  if (!league) throw new Error(`could not ensure league row for ${slug}`);
  return league.id;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  /** Events whose home/away assignment contradicted the stored row. */
  sideConflicts: string[];
}

/** Upsert a batch of normalized events for one league (B3-004, B3-005). */
export async function upsertEvents(
  db: DB,
  provider: string,
  league: LeagueSlug,
  batch: readonly ProviderEvent[],
): Promise<UpsertResult> {
  const leagueId = await ensureLeague(db, league);
  const result: UpsertResult = { inserted: 0, updated: 0, sideConflicts: [] };

  for (const e of batch) {
    const existing = await db.query.events.findFirst({
      where: and(eq(events.provider, provider), eq(events.providerEventId, e.providerEventId)),
    });

    if (!existing) {
      await db
        .insert(events)
        .values({
          leagueId,
          provider,
          providerEventId: e.providerEventId,
          homeTeam: e.home.name,
          awayTeam: e.away.name,
          homeTeamKey: e.home.key,
          awayTeamKey: e.away.key,
          startsAt: new Date(e.startsAt * 1000),
          status: e.status === "unknown" ? "scheduled" : e.status,
          homeScore: e.homeScore ?? null,
          awayScore: e.awayScore ?? null,
          lastPolledAt: new Date(),
        })
        .onConflictDoNothing();
      result.inserted += 1;
      continue;
    }

    // Guard the outcome-index anchor: a flipped home/away on a known event
    // would invert what YES means for any market already minted against it.
    if (
      existing.homeTeamKey &&
      existing.awayTeamKey &&
      (existing.homeTeamKey !== e.home.key || existing.awayTeamKey !== e.away.key)
    ) {
      logger.error(
        { providerEventId: e.providerEventId, stored: existing.homeTeamKey, incoming: e.home.key },
        "sports: provider flipped home/away for a known event — refusing to update",
      );
      result.sideConflicts.push(e.providerEventId);
      continue;
    }

    await db
      .update(events)
      .set({
        // `unknown` never overwrites a real status: absence of information
        // must not roll a final back to scheduled (spec §3.5).
        ...(e.status !== "unknown" ? { status: e.status } : {}),
        homeScore: e.homeScore ?? existing.homeScore,
        awayScore: e.awayScore ?? existing.awayScore,
        startsAt: new Date(e.startsAt * 1000),
        lastPolledAt: new Date(),
        updatedAt: sql`now()`,
      })
      .where(eq(events.id, existing.id));
    result.updated += 1;
  }

  return result;
}

// ─── Reference data: teams, players, injuries (S-003) ───────────────────────
//
// These passes only run when the active provider offers the matching
// capability (provider.ts) — Sportradar does, ESPN does not — so nothing
// below changes behavior for an ESPN-only deployment. Same idempotency
// convention as events: upserts keyed on the schema's unique constraints
// ((league, key) for teams; (provider, provider_player_id) for players), so
// re-running a tick can never duplicate a row.

/** Upsert the league's teams; returns key → team UUID for linking. */
export async function upsertTeams(
  db: DB,
  provider: string,
  league: LeagueSlug,
  batch: readonly ProviderTeam[],
): Promise<Map<string, string>> {
  const leagueId = await ensureLeague(db, league);
  const byKey = new Map<string, string>();

  for (const t of batch) {
    const inserted = await db
      .insert(teams)
      .values({
        leagueId,
        key: t.key,
        name: t.name,
        abbreviation: t.abbreviation,
        logoUrl: t.logo ?? null,
        provider,
        providerTeamId: t.providerId,
      })
      .onConflictDoUpdate({
        target: [teams.leagueId, teams.key],
        set: {
          name: t.name,
          abbreviation: t.abbreviation,
          ...(t.logo ? { logoUrl: t.logo } : {}),
          provider,
          providerTeamId: t.providerId,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: teams.id, key: teams.key });
    const row = inserted.at(0);
    if (row) byKey.set(row.key, row.id);
  }
  return byKey;
}

/**
 * Backfill `events.home_team_id`/`away_team_id` from the provider-agnostic
 * team keys. Only null links are written: the key columns are the anchor
 * (store rule at the top of this file), and a populated link is never
 * re-pointed by a later pass.
 */
export async function linkEventTeams(db: DB, league: LeagueSlug): Promise<number> {
  const leagueId = await ensureLeague(db, league);
  const teamRows = await db
    .select({ id: teams.id, key: teams.key })
    .from(teams)
    .where(eq(teams.leagueId, leagueId));
  const byKey = new Map(teamRows.map((t) => [t.key, t.id]));

  const unlinked = await db
    .select({
      id: events.id,
      homeTeamKey: events.homeTeamKey,
      awayTeamKey: events.awayTeamKey,
      homeTeamId: events.homeTeamId,
      awayTeamId: events.awayTeamId,
    })
    .from(events)
    .where(
      and(eq(events.leagueId, leagueId), or(isNull(events.homeTeamId), isNull(events.awayTeamId))),
    );

  let linked = 0;
  for (const e of unlinked) {
    const homeId = e.homeTeamId ?? (e.homeTeamKey ? (byKey.get(e.homeTeamKey) ?? null) : null);
    const awayId = e.awayTeamId ?? (e.awayTeamKey ? (byKey.get(e.awayTeamKey) ?? null) : null);
    if (homeId === e.homeTeamId && awayId === e.awayTeamId) continue;
    await db
      .update(events)
      .set({ homeTeamId: homeId, awayTeamId: awayId, updatedAt: sql`now()` })
      .where(eq(events.id, e.id));
    linked += 1;
  }
  return linked;
}

/** Upsert one team's roster. Returns how many player rows were written. */
export async function upsertPlayers(
  db: DB,
  provider: string,
  league: LeagueSlug,
  batch: readonly ProviderPlayer[],
  teamIdsByKey: ReadonlyMap<string, string>,
): Promise<number> {
  const leagueId = await ensureLeague(db, league);
  let written = 0;
  for (const p of batch) {
    // A roster entry whose team is not in the canonical table yet keeps a
    // null teamId — free agents and mid-trade players are legal per the
    // schema, and the next hierarchy pass heals the link.
    const teamId = teamIdsByKey.get(p.teamKey) ?? null;
    await db
      .insert(players)
      .values({
        leagueId,
        teamId,
        name: p.name,
        position: p.position ?? null,
        jerseyNumber: p.jerseyNumber ?? null,
        status: p.status,
        provider,
        providerPlayerId: p.providerPlayerId,
      })
      .onConflictDoUpdate({
        target: [players.provider, players.providerPlayerId],
        set: {
          teamId,
          name: p.name,
          position: p.position ?? null,
          jerseyNumber: p.jerseyNumber ?? null,
          status: p.status,
          updatedAt: sql`now()`,
        },
      });
    written += 1;
  }
  return written;
}

/**
 * Teams whose roster data is stalest, for the quota-aware rotation: the
 * ingest worker refreshes a few rosters per tick (oldest first) instead of
 * all 32, so a trial key's 1,000-calls/30-days budget covers the league on
 * a rolling cycle. Teams with no players yet sort first.
 */
export async function stalestRosterTeams(
  db: DB,
  league: LeagueSlug,
  limit: number,
): Promise<{ id: string; key: string; providerTeamId: string | null }[]> {
  const leagueId = await ensureLeague(db, league);
  const rows = await db
    .select({
      id: teams.id,
      key: teams.key,
      providerTeamId: teams.providerTeamId,
      freshest: sql<string | null>`max(${players.updatedAt})`,
    })
    .from(teams)
    .leftJoin(players, eq(players.teamId, teams.id))
    .where(eq(teams.leagueId, leagueId))
    .groupBy(teams.id, teams.key, teams.providerTeamId)
    .orderBy(sql`max(${players.updatedAt}) asc nulls first`)
    .limit(limit);
  return rows.map(({ id, key, providerTeamId }) => ({ id, key, providerTeamId }));
}

/** Open injury rows for a league's players, as the pure planner's input. */
export async function listOpenInjuries(
  db: DB,
  provider: string,
  league: LeagueSlug,
): Promise<{ id: string; providerPlayerId: string; status: string; description: string | null }[]> {
  const leagueId = await ensureLeague(db, league);
  return db
    .select({
      id: injuries.id,
      providerPlayerId: players.providerPlayerId,
      status: injuries.status,
      description: injuries.description,
    })
    .from(injuries)
    .innerJoin(players, eq(injuries.playerId, players.id))
    .where(
      and(
        eq(injuries.provider, provider),
        isNull(injuries.resolvedAt),
        eq(players.leagueId, leagueId),
      ),
    )
    .orderBy(asc(injuries.reportedAt));
}

export interface InjuryApplyResult {
  opened: number;
  resolved: number;
  touched: number;
  /** Reports for players not yet in the `players` table — healed by the
   *  next roster pass, so skipping (not failing) is correct. */
  skippedUnknownPlayers: number;
}

/**
 * Apply a planned set of injury transitions (see `planInjuryTransitions` in
 * ingest.ts — the pure half). Open/resolve follows the schema convention:
 * a player's current status is the latest open row, `resolvedAt` closes it.
 */
export async function applyInjuryPlan(
  db: DB,
  provider: string,
  league: LeagueSlug,
  plan: InjuryTransitionPlan,
): Promise<InjuryApplyResult> {
  const leagueId = await ensureLeague(db, league);
  const result: InjuryApplyResult = {
    opened: 0,
    resolved: 0,
    touched: plan.touch.length,
    skippedUnknownPlayers: 0,
  };

  for (const id of plan.resolve) {
    await db
      .update(injuries)
      .set({ resolvedAt: sql`now()` })
      .where(eq(injuries.id, id));
    result.resolved += 1;
  }

  for (const report of plan.open) {
    const player = await db.query.players.findFirst({
      where: and(
        eq(players.provider, provider),
        eq(players.providerPlayerId, report.providerPlayerId),
        eq(players.leagueId, leagueId),
      ),
    });
    if (!player) {
      result.skippedUnknownPlayers += 1;
      continue;
    }
    await db.insert(injuries).values({
      playerId: player.id,
      teamId: player.teamId,
      status: report.status,
      description: report.description ?? null,
      provider,
      providerUpdatedAt:
        report.providerUpdatedAt !== undefined ? new Date(report.providerUpdatedAt * 1000) : null,
    });
    result.opened += 1;
  }

  return result;
}

// ─── Reference-data refresh (S-003 orchestration) ───────────────────────────

export interface ReferenceRefreshResult {
  league: LeagueSlug;
  provider: string;
  /** null = the provider offers no such capability (e.g. ESPN). */
  teams: { upserted: number; eventsLinked: number; delayed: boolean } | null;
  rosters: { teamsRefreshed: number; playersUpserted: number } | null;
  injuries: (InjuryApplyResult & { reports: number; delayed: boolean }) | null;
}

/**
 * S-003's canonical-table pass: teams (hierarchy), players (rosters, on a
 * quota-aware rotation) and injuries (open/resolve), for providers that
 * offer the capabilities. A capability-less provider (ESPN) yields all-null
 * — the pass is a no-op and existing behavior is untouched. Decision logic
 * is the pure planners in ingest.ts; this function only sequences fetch →
 * plan → write.
 *
 * `maxRosterTeams` bounds upstream calls per tick: a trial Sportradar key
 * has ~33 requests/day of budget, so rosters rotate (stalest first) instead
 * of fetching all 32 teams every tick.
 */
export async function refreshReferenceData(
  db: DB,
  provider: SportsDataProvider,
  league: LeagueSlug,
  maxRosterTeams = 4,
): Promise<ReferenceRefreshResult> {
  const result: ReferenceRefreshResult = {
    league,
    provider: provider.name,
    teams: null,
    rosters: null,
    injuries: null,
  };

  let teamIdsByKey: ReadonlyMap<string, string> = new Map();

  if (typeof provider.getTeams === "function") {
    const feed = await provider.getTeams(league);
    teamIdsByKey = await upsertTeams(db, feed.provider, league, feed.items);
    const eventsLinked = await linkEventTeams(db, league);
    recordFeedPoll("teams", league, feed.provider, feed.delayed);
    result.teams = { upserted: teamIdsByKey.size, eventsLinked, delayed: feed.delayed };
  }

  if (typeof provider.getRoster === "function" && maxRosterTeams > 0) {
    const rotation = await stalestRosterTeams(db, league, maxRosterTeams);
    let playersUpserted = 0;
    let teamsRefreshed = 0;
    let anyDelayed = false;
    for (const team of rotation) {
      if (!team.providerTeamId) continue;
      try {
        const feed = await provider.getRoster(league, team.providerTeamId);
        anyDelayed ||= feed.delayed;
        playersUpserted += await upsertPlayers(db, feed.provider, league, feed.items, teamIdsByKey);
        teamsRefreshed += 1;
      } catch (err) {
        // One team's roster failing must not stop the rotation — the team
        // stays stalest and leads the next tick's batch.
        logger.warn({ league, teamKey: team.key, err: String(err) }, "sports: roster failed");
      }
    }
    recordFeedPoll("rosters", league, provider.name, anyDelayed);
    result.rosters = { teamsRefreshed, playersUpserted };
  }

  if (typeof provider.getInjuries === "function") {
    const feed = await provider.getInjuries(league);
    const openRows = await listOpenInjuries(db, feed.provider, league);
    const plan = planInjuryTransitions(openRows, feed.items, feed.delayed);
    const applied = await applyInjuryPlan(db, feed.provider, league, plan);
    recordFeedPoll("injuries", league, feed.provider, feed.delayed);
    result.injuries = { ...applied, reports: feed.items.length, delayed: feed.delayed };
  }

  return result;
}

// ─── Canonical slate reads (S-003 outage path) ──────────────────────────────

export interface CanonicalEventRow {
  providerEventId: string;
  startsAt: Date;
  status: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamKey: string | null;
  awayTeamKey: string | null;
  homeScore: number | null;
  awayScore: number | null;
  lastPolledAt: Date | null;
}

export interface CanonicalSlate {
  events: CanonicalEventRow[];
  /**
   * Freshness of the canonical copy: the most recent `last_polled_at` among
   * the returned events, ms epoch — null when nothing was ever ingested.
   * This is the `dataAsOf` surfaced to callers when the provider is down:
   * the board can keep rendering last-good data while saying HOW old it is,
   * and the resolution service (which requires live, non-delayed reads)
   * ignores it entirely.
   */
  dataAsOf: number | null;
}

/**
 * Last-good events for a league from the canonical table — the serve-through
 * copy for provider outages. Window defaults to yesterday→+7d, mirroring the
 * board's horizon.
 */
export async function readCanonicalSlate(
  db: DB,
  league: LeagueSlug,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  windowBackDays = 1,
  windowForwardDays = 7,
): Promise<CanonicalSlate> {
  const leagueId = await ensureLeague(db, league);
  const from = new Date((nowSeconds - windowBackDays * 86_400) * 1000);
  const to = new Date((nowSeconds + windowForwardDays * 86_400) * 1000);
  const rows = await db
    .select({
      providerEventId: events.providerEventId,
      startsAt: events.startsAt,
      status: events.status,
      homeTeam: events.homeTeam,
      awayTeam: events.awayTeam,
      homeTeamKey: events.homeTeamKey,
      awayTeamKey: events.awayTeamKey,
      homeScore: events.homeScore,
      awayScore: events.awayScore,
      lastPolledAt: events.lastPolledAt,
    })
    .from(events)
    .where(
      and(
        eq(events.leagueId, leagueId),
        sql`${events.startsAt} >= ${from} AND ${events.startsAt} <= ${to}`,
      ),
    )
    .orderBy(asc(events.startsAt));

  let dataAsOf: number | null = null;
  for (const r of rows) {
    const t = r.lastPolledAt?.getTime();
    if (t !== undefined && (dataAsOf === null || t > dataAsOf)) dataAsOf = t;
  }
  return { events: rows, dataAsOf };
}

// ─── Market rows (B4-006 prerequisite) ──────────────────────────────────────

/**
 * Persist the markets the on-chain sweep touched. The `resolutions` log
 * FK-references `markets.market_id`, so a row must exist BEFORE settlement
 * can be recorded — this runs on every sync tick and is idempotent
 * (insert-or-update keyed on the deterministic market id).
 */
export async function upsertMarketRows(
  db: DB,
  provider: string,
  details: readonly OnChainMarketDetail[],
  chainId = 8453,
): Promise<number> {
  let written = 0;
  for (const d of details) {
    const eventRow = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.provider, provider), eq(events.providerEventId, d.providerEventId)))
      .limit(1);
    const eventId = eventRow.at(0)?.id;
    if (!eventId) continue; // event not ingested yet — next tick heals

    await db
      .insert(markets)
      .values({
        marketId: d.marketId,
        eventId,
        marketType: "moneyline",
        outcomeIndex: d.outcomeIndex,
        chainId,
        yesToken: d.yesToken,
        noToken: d.noToken,
        poolId: d.poolId,
        openingProbability: d.openingProbability.toFixed(5),
      })
      .onConflictDoUpdate({
        target: markets.marketId,
        set: {
          yesToken: d.yesToken,
          noToken: d.noToken,
          poolId: d.poolId,
          updatedAt: new Date(),
        },
      });
    written += 1;
  }
  return written;
}

/**
 * Markets worth a re-band scan on one chain: any market whose game has not
 * kicked off yet — the only window where the book is OPEN and tradeable, so
 * the only window where an out-of-band price can (and must) be arbed back.
 * As with reclaim below, the DB is just the candidate list; the sweeper
 * reads each market's on-chain state and skips anything not actually OPEN.
 */
export async function listRebandCandidates(
  db: DB,
  chainId: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ marketId: string; yesToken: string | null; noToken: string | null }[]> {
  const now = new Date(nowSeconds * 1000);
  return db
    .select({ marketId: markets.marketId, yesToken: markets.yesToken, noToken: markets.noToken })
    .from(markets)
    .innerJoin(events, eq(markets.eventId, events.id))
    .where(and(eq(markets.chainId, chainId), sql`${events.startsAt} >= ${now}`));
}

/**
 * Markets worth a reclaim scan on one chain: any market whose game started
 * in the last 14 days (older ones have long been reclaimed — on-chain state
 * makes a re-scan a no-op anyway, this bound just caps the read fan-out).
 * The sweeper reads each market's on-chain state to decide what to do, so
 * the DB's `state` column is deliberately not trusted here.
 */
export async function listReclaimCandidates(
  db: DB,
  chainId: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ marketId: string; yesToken: string | null; noToken: string | null }[]> {
  const windowStart = new Date((nowSeconds - 14 * 86_400) * 1000);
  const now = new Date(nowSeconds * 1000);
  return db
    .select({ marketId: markets.marketId, yesToken: markets.yesToken, noToken: markets.noToken })
    .from(markets)
    .innerJoin(events, eq(markets.eventId, events.id))
    .where(
      and(
        eq(markets.chainId, chainId),
        sql`${events.startsAt} >= ${windowStart} AND ${events.startsAt} < ${now}`,
      ),
    );
}
