/**
 * Task 079, slice 2 — the record-and-form reconstruction (owner, 2026-10-29).
 *
 * The ledger started filling on 2026-10-29, so there is no timestamp-safe
 * history of the estimator's own forecasts. What CAN be rebuilt honestly
 * from a season's finals is the part of the estimator that depends only on
 * results: venue, season record and recent form, each computed from games
 * that had finished BEFORE the kickoff being forecast. Injuries, the book
 * line and head-to-head beyond this season are not reconstructible, so
 * this is a partial-input lower bound on the estimator, never its score.
 *
 * Pure: the caller supplies the season's games; nothing here reads a feed.
 */

import { analyzeSide, type AnalysisFacts, type SideFacts } from "../agent/sports-intelligence.ts";

export interface GameRow {
  id: string;
  /** Kickoff, unix ms. */
  startsAt: number;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  final: boolean;
  week?: number;
}

export interface ReconstructedForecast {
  id: string;
  week: number | null;
  startsAt: number;
  home: string;
  away: string;
  /** Home side's win probability from venue + record + form only. */
  homeProbabilityBps: number;
  /** 1 home won, 0 away won, null not final or tied. */
  outcome: 0 | 1 | null;
}

const FORM_GAMES = 5;

/** Finals that had ended before `beforeMs` — the only games a pregame view may see. */
export function finalsBefore(games: readonly GameRow[], beforeMs: number): GameRow[] {
  return games
    .filter((g) => g.final && g.startsAt < beforeMs)
    .sort((a, b) => b.startsAt - a.startsAt);
}

function resultFor(g: GameRow, team: string): "W" | "L" | "T" {
  const us = g.home === team ? g.homeScore : g.awayScore;
  const them = g.home === team ? g.awayScore : g.homeScore;
  return us > them ? "W" : us < them ? "L" : "T";
}

/** A side's record and form from the finals it had played before the kickoff. */
export function sideFactsAt(priorFinals: readonly GameRow[], team: string): SideFacts {
  const mine = priorFinals.filter((g) => g.home === team || g.away === team);
  const results = mine.map((g) => resultFor(g, team));
  const record =
    results.length === 0
      ? null
      : {
          wins: results.filter((r) => r === "W").length,
          losses: results.filter((r) => r === "L").length,
          ties: results.filter((r) => r === "T").length,
        };
  return { name: team, record, recentForm: results.slice(0, FORM_GAMES), injuries: [] };
}

/** The estimator's facts for the home side of `game`, from prior finals only. */
export function factsAt(games: readonly GameRow[], game: GameRow, league = "nfl"): AnalysisFacts {
  const prior = finalsBefore(games, game.startsAt);
  const meetings = prior.filter(
    (g) =>
      (g.home === game.home && g.away === game.away) ||
      (g.home === game.away && g.away === game.home),
  );
  let headToHead: AnalysisFacts["headToHead"] = null;
  if (meetings.length > 0) {
    const r = meetings.map((g) => resultFor(g, game.home));
    headToHead = {
      teamWins: r.filter((x) => x === "W").length,
      opponentWins: r.filter((x) => x === "L").length,
      ties: r.filter((x) => x === "T").length,
    };
  }
  return {
    league,
    side: "home",
    team: sideFactsAt(prior, game.home),
    opponent: sideFactsAt(prior, game.away),
    headToHead,
    live: null,
    gameStatus: "scheduled",
    marketImpliedBps: null,
    marketAgeSeconds: null,
    liquidityUsdc: null,
    delayed: false,
  };
}

export function reconstructSeason(games: readonly GameRow[]): ReconstructedForecast[] {
  return [...games]
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((g) => ({
      id: g.id,
      week: g.week ?? null,
      startsAt: g.startsAt,
      home: g.home,
      away: g.away,
      homeProbabilityBps: analyzeSide(factsAt(games, g)).probabilityBps,
      outcome: !g.final || g.homeScore === g.awayScore ? null : g.homeScore > g.awayScore ? 1 : 0,
    }));
}

export interface ReconstructionScore {
  n: number;
  brier: number | null;
  logLoss: number | null;
  /** Brier of a flat 50% forecast on the same games, for scale. */
  coinFlipBrier: number | null;
  /** Share of games where the favoured side (p ≠ 50%) won. */
  favouriteHitRate: number | null;
}

export function scoreReconstruction(rows: readonly ReconstructedForecast[]): ReconstructionScore {
  const scored = rows.filter(
    (r): r is ReconstructedForecast & { outcome: 0 | 1 } => r.outcome !== null,
  );
  const n = scored.length;
  if (n === 0)
    return { n, brier: null, logLoss: null, coinFlipBrier: null, favouriteHitRate: null };
  let brier = 0;
  let logLoss = 0;
  let picks = 0;
  let hits = 0;
  for (const r of scored) {
    const p = Math.min(0.999, Math.max(0.001, r.homeProbabilityBps / 10_000));
    brier += (p - r.outcome) ** 2;
    logLoss += -(r.outcome === 1 ? Math.log(p) : Math.log(1 - p));
    if (r.homeProbabilityBps !== 5000) {
      picks += 1;
      if (r.homeProbabilityBps > 5000 === (r.outcome === 1)) hits += 1;
    }
  }
  return {
    n,
    brier: brier / n,
    logLoss: logLoss / n,
    coinFlipBrier: 0.25,
    favouriteHitRate: picks === 0 ? null : hits / picks,
  };
}
