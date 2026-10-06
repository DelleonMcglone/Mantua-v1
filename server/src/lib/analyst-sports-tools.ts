/**
 * The free sports reads the logged-out analyst shares with the Sports
 * Agent (owner report 2026-10-05: the no-money starter prompts returned
 * nothing useful — the analyst only had the slate and the schedule).
 * Every tool here is read-only and served from the canonical database;
 * the definitions are the agent's own, so both surfaces describe a tool
 * identically.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/client.ts";
import { toolDefinitions } from "./agent-chat.ts";
import {
  analyzeMarket,
  getGame,
  getHeadToHead,
  getPlayerInjuryStatus,
  getRecentGames,
  getStandings,
  getTeamStats,
  makeSportsToolsDb,
} from "./sports/agent-sports-tools.ts";
import { scanProbabilityGaps } from "./sports/probability-gaps.ts";

const dbx = makeSportsToolsDb(db);

type Run = (input: Record<string, unknown>) => Promise<unknown>;

const RUNNERS: Partial<Record<string, Run>> = {
  get_game: (i) => getGame(dbx, i),
  get_team_stats: (i) => getTeamStats(dbx, i),
  get_player_injury_status: (i) => getPlayerInjuryStatus(dbx, i),
  get_recent_games: (i) => getRecentGames(dbx, i),
  get_head_to_head: (i) => getHeadToHead(dbx, i),
  get_standings: (i) => getStandings(dbx, i),
  mantua_analyze_market: (i) => analyzeMarket(dbx, i),
  mantua_probability_gaps: (i) => scanProbabilityGaps(dbx, i),
};

export const ANALYST_SPORTS_TOOL_NAMES: readonly string[] = Object.keys(RUNNERS);

/** The agent's definitions of these tools, in the analyst's tool list. */
export function analystSportsTools(): Anthropic.Tool[] {
  return toolDefinitions(ANALYST_SPORTS_TOOL_NAMES);
}

/** Run one of the shared reads; undefined when the name is not one of them. */
export function runAnalystSportsTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> | undefined {
  return RUNNERS[name]?.(input);
}
