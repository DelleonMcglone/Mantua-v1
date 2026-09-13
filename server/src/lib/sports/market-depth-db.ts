/**
 * Phase 12 — binds the depth read's `DepthDb` seam to Postgres: the event
 * with its league and teams, the moneyline markets, the metrics module,
 * the latest play and the first play of each period, and injury reports
 * for the two teams.
 */
import { and, asc, desc, eq, gte, inArray, min } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { db as defaultDb } from "../../db/client.ts";
import {
  events,
  gamePlays,
  injuries,
  leagues,
  markets,
  players,
  teams,
} from "../../db/schema/index.ts";
import type { DepthDb, DepthEvent, PlayRow } from "./market-depth-read.ts";
import { getMarketMetrics } from "./market-metrics.ts";

const sec = (d: Date | null): number | null => (d ? Math.floor(d.getTime() / 1000) : null);

export function makeDepthDb(db: DB = defaultDb): DepthDb {
  return {
    async findEvent(providerEventId): Promise<DepthEvent | null> {
      const row = (
        await db
          .select({ event: events, league: leagues.slug })
          .from(events)
          .innerJoin(leagues, eq(events.leagueId, leagues.id))
          .where(eq(events.providerEventId, providerEventId))
          .limit(1)
      ).at(0);
      if (!row) return null;
      const e = row.event;
      const ids = [e.homeTeamId, e.awayTeamId].filter((t): t is string => t !== null);
      const teamRows = ids.length
        ? await db
            .select({ id: teams.id, abbreviation: teams.abbreviation })
            .from(teams)
            .where(inArray(teams.id, ids))
        : [];
      const abbr = (id: string | null) => teamRows.find((t) => t.id === id)?.abbreviation ?? null;
      return {
        id: e.id,
        league: row.league,
        providerEventId: e.providerEventId,
        startsAt: Math.floor(e.startsAt.getTime() / 1000),
        status: e.status,
        homeScore: e.homeScore,
        awayScore: e.awayScore,
        home: { teamId: e.homeTeamId, key: e.homeTeamKey, abbreviation: abbr(e.homeTeamId) },
        away: { teamId: e.awayTeamId, key: e.awayTeamKey, abbreviation: abbr(e.awayTeamId) },
      };
    },
    async moneylineMarkets(eventId) {
      const rows = await db
        .select({
          marketId: markets.marketId,
          outcomeIndex: markets.outcomeIndex,
          frozenAt: markets.frozenAt,
          resolvedAt: markets.resolvedAt,
        })
        .from(markets)
        .where(and(eq(markets.eventId, eventId), eq(markets.marketType, "moneyline")));
      return rows.map((r) => ({ ...r, frozenAt: sec(r.frozenAt), resolvedAt: sec(r.resolvedAt) }));
    },
    metrics: (marketId) => getMarketMetrics(marketId, db),
    async latestPlay(eventId): Promise<PlayRow | null> {
      const p = (
        await db
          .select()
          .from(gamePlays)
          .where(eq(gamePlays.eventId, eventId))
          .orderBy(desc(gamePlays.sequence))
          .limit(1)
      ).at(0);
      if (!p) return null;
      const detail =
        typeof p.detail === "object" && p.detail !== null
          ? (p.detail as Record<string, unknown>)
          : {};
      const after = detail["possessionAfter"];
      return {
        period: p.period,
        clock: p.clock,
        description: p.description,
        teamKey: p.teamKey,
        possessionAfter: typeof after === "string" ? after : null,
        at: Math.floor(p.createdAt.getTime() / 1000),
      };
    },
    async periodStarts(eventId) {
      const rows = await db
        .select({ period: gamePlays.period, at: min(gamePlays.createdAt) })
        .from(gamePlays)
        .where(eq(gamePlays.eventId, eventId))
        .groupBy(gamePlays.period)
        .orderBy(asc(gamePlays.period));
      return rows
        .filter((r): r is { period: number; at: Date } => r.period !== null && r.at instanceof Date)
        .map((r) => ({ period: r.period, at: Math.floor(r.at.getTime() / 1000) }));
    },
    async injuries(teamIds, sinceSec) {
      if (teamIds.length === 0) return [];
      const rows = await db
        .select({
          at: injuries.reportedAt,
          teamId: injuries.teamId,
          status: injuries.status,
          description: injuries.description,
          player: players.name,
        })
        .from(injuries)
        .innerJoin(players, eq(injuries.playerId, players.id))
        .where(
          and(
            inArray(injuries.teamId, teamIds),
            gte(injuries.reportedAt, new Date(sinceSec * 1000)),
          ),
        )
        .orderBy(desc(injuries.reportedAt))
        .limit(12);
      return rows.map((r) => ({ ...r, at: Math.floor(r.at.getTime() / 1000) }));
    },
  };
}
