/**
 * Phase 7 / R-005 — the platform's degradation state, computed in one place
 * and served to every client (`GET /api/status`, the live stream's `status`
 * event), so a degraded platform is never silent: reads stay live while
 * writes degrade, and the banner says exactly what is closed, what still
 * trades, and what is safe.
 *
 * Pure over its inputs (feed freshness per league, the kill switch, the
 * provider breakers, RPC health) so the ladder is unit-tested without a DB.
 * The rules mirror the enforcement points — a league counts as buy-halted
 * here under exactly the rule `assessMarketTradability` (P-012) refuses a
 * buy, and `delayed` under exactly the rule the slate route labels data
 * delayed — so the banner and the refusal never disagree.
 */

import { CANONICAL_FRESH_MS } from "./sports/public-slate.ts";
import { IN_PLAY_FEED_MAX_AGE_MS } from "./sports/market-trade-build.ts";

export interface LeagueFeedInput {
  league: string;
  /** Most recent ingest for the league (ms epoch); null when never ingested. */
  dataAsOf: number | null;
  /** Games currently in play (kicked off, not final). */
  liveGames: number;
}

export interface RpcHealthInput {
  healthy: boolean;
  /** Short operator-facing detail ("2 of 2 hosts rate-limited"). */
  detail?: string;
}

export interface PlatformStatusInput {
  feeds: readonly LeagueFeedInput[];
  killSwitch: boolean;
  /** `activeBreakerState()` — provider → host → breaker. */
  providerBreakers: Record<string, Record<string, { failures: number; open: boolean }>>;
  /** Lane 052 supplies this from the RPC client's breakers; null = unknown. */
  rpc: RpcHealthInput | null;
}

export interface LeagueFeedStatus {
  dataAsOf: number | null;
  /** ms since the last ingest; null when never ingested. */
  ageMs: number | null;
  /** The slate route's rule: older than CANONICAL_FRESH_MS. */
  delayed: boolean;
  /** Games in play right now. */
  liveGames: number;
  /** P-012's rule: in play AND the feed is older than IN_PLAY_FEED_MAX_AGE_MS. */
  buysHalted: boolean;
}

export type PlatformMode = "live" | "degraded" | "paused";
export type TradingState = "open" | "buys_halted" | "paused";

export interface PlatformStatus {
  generatedAt: number;
  /** The one-word summary the banner keys off. */
  mode: PlatformMode;
  /** Are the read surfaces (scores, odds) current? */
  reads: "live" | "delayed";
  /** Are writes (trades) accepted? Sells stay open under `buys_halted`. */
  trading: TradingState;
  killSwitch: boolean;
  feeds: Record<string, LeagueFeedStatus>;
  /** Provider hosts whose breaker is open, as "provider:host". */
  openBreakers: string[];
  rpc: RpcHealthInput | null;
  /** The human line for the banner; null when everything is live. */
  message: string | null;
}

function leagueLabel(league: string): string {
  return league.toUpperCase();
}

function joinLeagues(leagues: readonly string[]): string {
  const labels = leagues.map(leagueLabel);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${String(labels.at(-1))}`;
}

/**
 * The degradation ladder, top down: an operator pause beats everything; a
 * dark feed during a live game halts buys (sells never close); stale data
 * or an open provider breaker or unhealthy RPC degrades reads but closes
 * nothing. `message` is written for the banner — it always says what is
 * closed, what still works, and what happens next (runbook §4 rules).
 */
export function assessPlatformStatus(
  input: PlatformStatusInput,
  now: number = Date.now(),
): PlatformStatus {
  const feeds: Record<string, LeagueFeedStatus> = {};
  for (const f of input.feeds) {
    const ageMs = f.dataAsOf === null ? null : Math.max(0, now - f.dataAsOf);
    const delayed = ageMs === null || ageMs > CANONICAL_FRESH_MS;
    const buysHalted = f.liveGames > 0 && (ageMs === null || ageMs > IN_PLAY_FEED_MAX_AGE_MS);
    feeds[f.league] = { dataAsOf: f.dataAsOf, ageMs, delayed, liveGames: f.liveGames, buysHalted };
  }

  const entries = Object.entries(feeds);
  const haltedLeagues = entries.filter(([, s]) => s.buysHalted).map(([l]) => l);
  const liveDelayed = entries.filter(([, s]) => s.liveGames > 0 && s.delayed).map(([l]) => l);
  // Reads count as delayed when a league with a game in play is stale, or
  // when EVERY league is stale (ingest is dark platform-wide). An off-season
  // league that has not been ingested for days is not, by itself, a
  // platform degradation — the board labels that league on its own.
  const allDelayed = entries.length > 0 && entries.every(([, s]) => s.delayed);
  const readsDelayed = liveDelayed.length > 0 || allDelayed;

  const openBreakers: string[] = [];
  for (const [provider, hosts] of Object.entries(input.providerBreakers)) {
    for (const [host, b] of Object.entries(hosts)) {
      if (b.open) openBreakers.push(`${provider}:${host}`);
    }
  }
  const rpcUnhealthy = input.rpc !== null && !input.rpc.healthy;

  const trading: TradingState = input.killSwitch
    ? "paused"
    : haltedLeagues.length > 0
      ? "buys_halted"
      : "open";
  const mode: PlatformMode = input.killSwitch
    ? "paused"
    : trading === "buys_halted" || readsDelayed || openBreakers.length > 0 || rpcUnhealthy
      ? "degraded"
      : "live";

  let message: string | null = null;
  if (input.killSwitch) {
    message =
      "Trading is paused by the operator. Markets, scores and balances stay viewable; " +
      "no new orders are accepted until trading resumes.";
  } else if (haltedLeagues.length > 0) {
    message =
      `The live ${joinLeagues(haltedLeagues)} data feed is stale — new buys on games in play are ` +
      "paused until it recovers. Selling an existing position is unaffected.";
  } else if (readsDelayed) {
    message = "Live data is delayed — scores and odds may lag the game. Trading stays open.";
  } else if (openBreakers.length > 0) {
    message = "A sports data provider is degraded — scores may lag. Trading stays open.";
  } else if (rpcUnhealthy) {
    message =
      "Blockchain reads are degraded — balances and market prices may lag. " +
      "Trades still settle on-chain.";
  }

  return {
    generatedAt: now,
    mode,
    reads: readsDelayed ? "delayed" : "live",
    trading,
    killSwitch: input.killSwitch,
    feeds,
    openBreakers,
    rpc: input.rpc,
    message,
  };
}

/** Seams for the live snapshot — production reads the DB, Redis and the
 *  in-process breaker registries; tests inject fakes. */
export interface PlatformStatusDeps {
  readFeeds: () => Promise<readonly LeagueFeedInput[]>;
  readKillSwitch: () => Promise<boolean>;
  readBreakers: () => PlatformStatusInput["providerBreakers"];
  readRpcHealth: () => RpcHealthInput | null;
  now: () => number;
}

/**
 * One status snapshot. Each input is best-effort and fails toward
 * "degraded, and say so": a DB error reading feed freshness reports every
 * league as never-ingested (delayed, buys halted if live — which is what
 * the trade gate would conclude too), never as live.
 */
export async function readPlatformStatus(deps: PlatformStatusDeps): Promise<PlatformStatus> {
  const [feeds, killSwitch] = await Promise.all([
    deps.readFeeds().catch((): readonly LeagueFeedInput[] => []),
    deps.readKillSwitch().catch(() => false),
  ]);
  return assessPlatformStatus(
    {
      feeds,
      killSwitch,
      providerBreakers: deps.readBreakers(),
      rpc: deps.readRpcHealth(),
    },
    deps.now(),
  );
}
