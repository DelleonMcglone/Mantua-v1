/**
 * Phase 12 (D-002) — the live game panel's text, from the fields the data
 * layer carries. A field the provider did not send is absent, never
 * invented. Pure; rendered by `LiveGamePanel.tsx`.
 */
import type { LiveGame } from "./depth-types.ts";

export interface LiveTeamRef {
  key: string;
  abbreviation: string;
}

export interface LiveGameView {
  /** "KC 14 · LV 10" (away first, as the board reads). */
  score: string | null;
  /** "Q2 · 07:12", "Q2", "07:12", or null. */
  situation: string | null;
  /** "KC ball" or null. */
  possession: string | null;
  lastPlay: string | null;
  asOf: number | null;
}

const QUARTER_LEAGUES = new Set(["nfl", "wnba", "nba"]);

export function periodName(league: string, period: number): string {
  if (QUARTER_LEAGUES.has(league)) {
    if (period > 4) return period === 5 ? "OT" : `OT${String(period - 4)}`;
    return `Q${String(period)}`;
  }
  return `Period ${String(period)}`;
}

export function liveGameView(input: {
  league: string;
  game: LiveGame;
  home: LiveTeamRef;
  away: LiveTeamRef;
}): LiveGameView | null {
  const { league, game, home, away } = input;
  if (game.status !== "in_progress") return null;
  const score =
    game.homeScore === null || game.awayScore === null
      ? null
      : `${away.abbreviation} ${String(game.awayScore)} · ${home.abbreviation} ${String(game.homeScore)}`;
  const parts: string[] = [];
  if (game.period !== null) parts.push(periodName(league, game.period));
  if (game.clock !== null) parts.push(game.clock);
  const side =
    game.possession === null
      ? null
      : game.possession === home.key
        ? home
        : game.possession === away.key
          ? away
          : null;
  return {
    score,
    situation: parts.length > 0 ? parts.join(" · ") : null,
    possession: side ? `${side.abbreviation} ball` : null,
    lastPlay: game.lastPlay,
    asOf: game.asOf,
  };
}
