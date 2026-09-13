/**
 * Phase 12 (D-001/D-002/D-005/D-006) — one read behind the market page's
 * deeper layer, keyed by event (never a market id, T-020): metrics, the
 * depth curve, the live game state, and chart annotations. The `DepthDb`
 * seam keeps the assembly pure; `market-depth-db.ts` binds it.
 */
import { depthCurve, type DepthCurve } from "./market-depth.ts";
import { annotationsFor, type ChartAnnotation } from "./market-depth-annotations.ts";
import type { MarketMetrics } from "./market-metrics.ts";

export interface DepthEvent {
  id: string;
  league: string | null;
  providerEventId: string;
  startsAt: number;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  home: { teamId: string | null; key: string | null; abbreviation: string | null };
  away: { teamId: string | null; key: string | null; abbreviation: string | null };
}

export interface DepthMarket {
  marketId: string;
  outcomeIndex: number;
  frozenAt: number | null;
  resolvedAt: number | null;
}

export interface PlayRow {
  period: number | null;
  clock: string | null;
  description: string | null;
  teamKey: string | null;
  possessionAfter: string | null;
  at: number;
}

export interface InjuryRow {
  at: number;
  teamId: string | null;
  player: string | null;
  status: string;
  description: string | null;
}

export interface DepthDb {
  findEvent(providerEventId: string): Promise<DepthEvent | null>;
  moneylineMarkets(eventId: string): Promise<DepthMarket[]>;
  metrics(marketId: string): Promise<MarketMetrics | null>;
  latestPlay(eventId: string): Promise<PlayRow | null>;
  periodStarts(eventId: string): Promise<{ period: number; at: number }[]>;
  injuries(teamIds: string[], sinceSec: number): Promise<InjuryRow[]>;
}

export interface LiveGame {
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  period: number | null;
  clock: string | null;
  /** Team key with the ball after the latest play; null when unknown. */
  possession: string | null;
  lastPlay: string | null;
  /** Unix seconds of the latest ingested play; null when none. */
  asOf: number | null;
}

export interface DepthMetrics {
  priceBps: number | null;
  source: string | null;
  capturedAt: number | null;
  change24hBps: number | null;
  volume: MarketMetrics["volume"];
  activity: MarketMetrics["activity"];
  openInterest: { contractsOpen: number; positions: number; supply: number | null };
  timing: MarketMetrics["timing"];
}

export interface MarketDepthRead {
  hasMarkets: boolean;
  game: LiveGame;
  metrics: DepthMetrics | null;
  depth: DepthCurve | null;
  annotations: ChartAnnotation[];
  computedAt: number;
}

const INJURY_LOOKBACK_SEC = 7 * 86_400; // reports this far before kickoff belong to the game

export function metricsSummary(m: MarketMetrics): DepthMetrics {
  const p = m.price.currentYesProbability;
  return {
    priceBps: p === null ? null : Math.round(Math.min(1, Math.max(0, p)) * 10_000),
    source: m.price.source,
    capturedAt: m.price.capturedAt,
    change24hBps: m.price.change24hBps,
    volume: m.volume,
    activity: m.activity,
    openInterest: {
      contractsOpen: m.openInterest.yesTokensOpen + m.openInterest.noTokensOpen,
      positions: m.openInterest.openPositionCount,
      supply: m.openInterest.yesSupply,
    },
    timing: m.timing,
  };
}

export function liveGame(event: DepthEvent, play: PlayRow | null): LiveGame {
  const live = event.status === "in_progress";
  return {
    status: event.status,
    homeScore: event.homeScore,
    awayScore: event.awayScore,
    period: live ? (play?.period ?? null) : null,
    clock: live ? (play?.clock ?? null) : null,
    possession: live ? (play?.possessionAfter ?? play?.teamKey ?? null) : null,
    lastPlay: live ? (play?.description ?? null) : null,
    asOf: play?.at ?? null,
  };
}

/** Null when the event is unknown; every other absence is an explicit null. */
export async function readMarketDepth(
  dbx: DepthDb,
  providerEventId: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<MarketDepthRead | null> {
  const event = await dbx.findEvent(providerEventId);
  if (!event) return null;
  const teamIds = [event.home.teamId, event.away.teamId].filter((t): t is string => t !== null);
  const [markets, play, periods, injuries] = await Promise.all([
    dbx.moneylineMarkets(event.id),
    dbx.latestPlay(event.id),
    dbx.periodStarts(event.id),
    dbx.injuries(teamIds, event.startsAt - INJURY_LOOKBACK_SEC),
  ]);
  const home = markets.find((m) => m.outcomeIndex === 0) ?? null;
  const raw = home ? await dbx.metrics(home.marketId) : null;
  const metrics = raw ? metricsSummary(raw) : null;
  return {
    hasMarkets: markets.length > 0,
    game: liveGame(event, play),
    metrics,
    depth: raw ? depthCurve(raw.liquidity.poolLiquidity, metrics?.priceBps ?? null) : null,
    annotations: annotationsFor({ event, market: home, periods, injuries, nowSec }),
    computedAt: nowSec,
  };
}
