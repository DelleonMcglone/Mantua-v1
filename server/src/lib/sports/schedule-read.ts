/**
 * Reading the season schedule back out of the canonical events table, for
 * the analyst's `get_nfl_schedule` tool. Free, read-only, no provider call.
 */
import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { events, leagues } from "../../db/schema/index.ts";

export interface ScheduleGame {
  startsAt: string;
  away: string;
  home: string;
  status: string;
  awayScore: number | null;
  homeScore: number | null;
}

/** The season a date falls in runs 1 August to the end of the next February. */
export function seasonWindow(now: Date): { from: Date; to: Date } {
  const year = now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return { from: new Date(Date.UTC(year, 7, 1)), to: new Date(Date.UTC(year + 1, 2, 1)) };
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** "browns", "Cleveland", "CLE" and "nfl:CLE" all match the Cleveland Browns. */
export function teamMatches(
  game: {
    homeTeam: string;
    awayTeam: string;
    homeTeamKey: string | null;
    awayTeamKey: string | null;
  },
  query: string,
): boolean {
  const q = norm(query);
  if (!q) return true;
  const names = [norm(game.homeTeam), norm(game.awayTeam)];
  const keys = [norm(game.homeTeamKey), norm(game.awayTeamKey)].map((k) => k.replace(/^nfl/, ""));
  return (
    names.some((n) => n.includes(q)) || keys.some((k) => k !== "" && k === q.replace(/^nfl/, ""))
  );
}

export function hasScore(status: string): boolean {
  return status === "final" || status === "in_progress";
}

function parseDay(raw: unknown): Date | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function readSchedule(
  db: DB,
  input: { team?: unknown; opponent?: unknown; from?: unknown; to?: unknown },
  now: Date = new Date(),
): Promise<{ games: ScheduleGame[]; from: string; to: string; note?: string }> {
  const season = seasonWindow(now);
  const from = parseDay(input.from) ?? season.from;
  const toDay = parseDay(input.to);
  const to = toDay ? new Date(toDay.getTime() + 86_399_000) : season.to;
  const rows = await db
    .select({
      startsAt: events.startsAt,
      homeTeam: events.homeTeam,
      awayTeam: events.awayTeam,
      homeTeamKey: events.homeTeamKey,
      awayTeamKey: events.awayTeamKey,
      status: events.status,
      homeScore: events.homeScore,
      awayScore: events.awayScore,
    })
    .from(events)
    .innerJoin(leagues, eq(events.leagueId, leagues.id))
    .where(and(eq(leagues.slug, "nfl"), gte(events.startsAt, from), lte(events.startsAt, to)))
    .orderBy(asc(events.startsAt))
    .limit(400);
  const team = typeof input.team === "string" ? input.team : "";
  const opponent = typeof input.opponent === "string" ? input.opponent : "";
  const games = rows
    .filter((r) => teamMatches(r, team) && teamMatches(r, opponent))
    .map((r) => ({
      startsAt: r.startsAt.toISOString(),
      away: r.awayTeam,
      home: r.homeTeam,
      status: r.status,
      // The feed reports 0–0 for a game that has not kicked off; a score
      // only means something once the game is under way or over.
      awayScore: hasScore(r.status) ? r.awayScore : null,
      homeScore: hasScore(r.status) ? r.homeScore : null,
    }));
  return {
    games,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    ...(games.length === 0 ? { note: "No games match in this window." } : {}),
  };
}
