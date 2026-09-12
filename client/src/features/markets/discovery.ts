/**
 * T-018 / T-019 / T-020 — market discovery as a pure filter/sort module.
 * The Discover page, the natural-language path (`parseDiscoverQuery`, used
 * by chat-intent.ts) and the quick-action chips all produce the same
 * `DiscoverFilters` object, so a phrase and a tap can never land in
 * different places. Nothing here takes or shows a market id or address.
 * Pure: no React, no `@/` imports.
 */

export type DiscoverStatus = "open" | "live" | "upcoming" | "final" | "all";
export type DiscoverWindow = "now" | "today" | "week" | "all";
export type DiscoverSort = "relevance" | "start" | "liquidity" | "popularity";

export interface DiscoverFilters {
  sport?: string;
  league?: string;
  /** Free text matched against team names / abbreviations. */
  team?: string;
  /** Free text matched against both teams of one game. */
  game?: string;
  status?: DiscoverStatus;
  startsWithin?: DiscoverWindow;
  minLiquidityUsdc?: number;
  sort?: DiscoverSort;
}

export interface DiscoverTeam {
  key: string;
  name: string;
  abbreviation: string;
  logo?: string;
}

/** Mirrors the server's `DiscoverMarketWire` (routes/market-discover.ts). */
export interface DiscoverMarket {
  league: string;
  providerEventId: string;
  startsAt: number;
  status: string;
  home: DiscoverTeam;
  away: DiscoverTeam;
  homeScore?: number;
  awayScore?: number;
  homeWinProbabilityBps?: number;
  liveOdds?: boolean;
  /** Open market with a live pool and a tradeable status. */
  tradeable: boolean;
  /** Approximate pool depth in dollars; 0 with no on-chain leg. */
  liquidityUsdc: number;
  volume24hUsdc: number;
  fills24h: number;
}

const DAY = 86_400;
const WEEK = 7 * DAY;

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamMatches(team: DiscoverTeam, needle: string): boolean {
  const hay = `${norm(team.name)} ${norm(team.abbreviation)} ${norm(team.key.split(":").at(-1) ?? "")}`;
  return needle.split(" ").every((w) => hay.includes(w));
}

function isLive(m: DiscoverMarket): boolean {
  return m.status === "in_progress";
}

function isFinal(m: DiscoverMarket): boolean {
  return !(m.status === "scheduled" || m.status === "in_progress");
}

export function popularity(m: DiscoverMarket): number {
  return m.volume24hUsdc + m.fills24h * 10;
}

/** Live first, then soonest kickoff, then deepest — the default order. */
function relevance(a: DiscoverMarket, b: DiscoverMarket): number {
  const rank = (m: DiscoverMarket) => (isLive(m) ? 0 : isFinal(m) ? 2 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) === 2) return b.startsAt - a.startsAt;
  if (a.startsAt !== b.startsAt) return a.startsAt - b.startsAt;
  return b.liquidityUsdc - a.liquidityUsdc;
}

export function applyDiscoverFilters(
  markets: readonly DiscoverMarket[],
  f: DiscoverFilters,
  nowSec: number = Math.floor(Date.now() / 1000),
): DiscoverMarket[] {
  const dayEnd = nowSec - (nowSec % DAY) + DAY;
  const team = f.team ? norm(f.team) : null;
  const game = f.game ? norm(f.game) : null;
  const league = f.league?.toLowerCase();
  const out = markets.filter((m) => {
    if (league && m.league !== league) return false;
    if (team && !(teamMatches(m.home, team) || teamMatches(m.away, team))) return false;
    if (game && !game.split(" ").every((w) => teamMatches(m.home, w) || teamMatches(m.away, w)))
      return false;
    switch (f.status ?? "all") {
      case "open":
        // "Open" means a market you can trade now, not merely a game
        // that has not finished.
        if (!m.tradeable || isFinal(m)) return false;
        break;
      case "live":
        if (!isLive(m)) return false;
        break;
      case "upcoming":
        if (isLive(m) || isFinal(m)) return false;
        break;
      case "final":
        if (!isFinal(m)) return false;
        break;
      case "all":
        break;
    }
    switch (f.startsWithin ?? "all") {
      case "now":
        if (!isLive(m)) return false;
        break;
      case "today":
        if (m.startsAt >= dayEnd) return false;
        break;
      case "week":
        if (m.startsAt >= nowSec + WEEK) return false;
        break;
      case "all":
        break;
    }
    if (f.minLiquidityUsdc !== undefined && m.liquidityUsdc < f.minLiquidityUsdc) return false;
    return true;
  });
  const sort = f.sort ?? "relevance";
  return out.sort((a, b) => {
    if (sort === "liquidity") return b.liquidityUsdc - a.liquidityUsdc || relevance(a, b);
    if (sort === "popularity") return popularity(b) - popularity(a) || relevance(a, b);
    if (sort === "start") return a.startsAt - b.startsAt;
    return relevance(a, b);
  });
}
