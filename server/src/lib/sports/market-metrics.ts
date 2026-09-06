/**
 * 038 / S-010 — Mantua's own market-data layer.
 *
 * Per-market metrics computed exclusively from what Mantua already
 * records — no external market-data vendor:
 *
 *   price + history      market_prices series (fallback: opening line)
 *   volume               market_fills USDC aggregates, total + 24h
 *   open interest        unredeemed market_positions + YES-token supply
 *   trading activity     fill counts, recency, unique traders
 *   concentration        top-holder share via the BaseScan holders read
 *   liquidity            liquidity captured with the price series, plus
 *                        live v4 pool liquidity (StateView) when the
 *                        market periphery is deployed — null before then
 *   timing               kickoff/freeze/resolve joins off the event
 *
 * Structure mirrors history.ts: pure `aggregate*`/`derive*` functions over
 * plain row shapes (unit-tested, no DB), a thin DB assembly, and a short
 * TTL cache (ttl-cache.ts) so the authless route can't stampede the DB.
 * Best-effort inputs (BaseScan, RPC) fail to null, never to an error —
 * a metric we can't compute is reported as null, not fabricated.
 */

import { parseAbi } from "viem";
import { and, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { db as defaultDb } from "../../db/client.ts";
import {
  events,
  marketFills,
  marketPositions,
  marketPrices,
  markets,
} from "../../db/schema/index.ts";
import { getTokenHolders } from "../basescan.ts";
import { isSupportedChainId } from "../chains.ts";
import { logger } from "../logger.ts";
import { MARKETS_BY_CHAIN, MARKETS_PERIPHERY_BY_CHAIN, STATE_VIEW_ABI } from "../markets-contracts.ts";
import { sqrtPriceX96ToRawProbability } from "../probability.ts";
import { getRpcClient } from "../rpc-client.ts";
import { TtlCache } from "../ttl-cache.ts";

const USDC_SCALE = 1e6;
const DAY_SECONDS = 86_400;
const HISTORY_POINTS = 100;
const ERC20_SUPPLY_ABI = parseAbi(["function totalSupply() view returns (uint256)"]);

// ─── Row shapes (pure layer) ─────────────────────────────────────────────────

export interface FillRow {
  address: string;
  direction: string;
  tokensRaw: string;
  usdcRaw: string;
  createdAt: Date;
}

export interface PriceRow {
  impliedProbability: string;
  source: string;
  liquidityRaw: string | null;
  capturedAt: Date;
}

export interface PositionRow {
  side: string;
  size: string;
  redeemedAt: Date | null;
}

// ─── Metric blocks ───────────────────────────────────────────────────────────

export interface VolumeMetrics {
  /** USDC, human units. */
  totalUsdc: number;
  usdc24h: number;
  buyCount: number;
  sellCount: number;
}

export interface ActivityMetrics {
  fillCount: number;
  fillCount24h: number;
  uniqueTraders: number;
  /** Unix seconds of the latest fill; null when the market never traded. */
  lastTradeAt: number | null;
}

export interface PriceMetrics {
  /** Latest recorded YES implied probability, 0–1; opening line when no
   *  capture exists yet; null when neither exists. */
  currentYesProbability: number | null;
  /** pool | consensus | opening | null — where the current price came from. */
  source: string | null;
  /** Unix seconds of the current price's capture; null for opening/none. */
  capturedAt: number | null;
  /** Basis-point move vs the last capture ≥24h old; null with <24h of data. */
  change24hBps: number | null;
  /** Bounded recent series, oldest first. */
  history: { t: number; p: number }[];
  /** Liquidity recorded alongside the latest capture (USDC 6dp raw). */
  latestLiquidityRaw: string | null;
}

export interface OpenInterestMetrics {
  /** Unredeemed YES/NO position tokens (human units) per Mantua's records. */
  yesTokensOpen: number;
  noTokensOpen: number;
  openPositionCount: number;
  /** On-chain YES-token total supply (human units); null pre-deployment
   *  or when the RPC read fails. */
  yesSupply: number | null;
}

export interface ConcentrationMetrics {
  /** Share of YES supply held by the largest holder, percent. */
  topHolderPct: number;
  /** Share held by the top ≤10 holders, percent. */
  top10Pct: number;
  holdersListed: number;
}

export interface MarketMetrics {
  marketId: string;
  state: string;
  chainId: number;
  outcomeIndex: number;
  event: {
    providerEventId: string;
    homeTeam: string;
    awayTeam: string;
    status: string;
    /** The team this market's YES token backs. */
    label: string;
  };
  price: PriceMetrics;
  volume: VolumeMetrics;
  activity: ActivityMetrics;
  openInterest: OpenInterestMetrics;
  /** Null when the holders read is unavailable (no token / API down). */
  concentration: ConcentrationMetrics | null;
  liquidity: {
    /** Live v4 pool liquidity (raw L). Null until the market periphery is
     *  deployed on the market's chain — graceful pre-deployment. */
    poolLiquidity: string | null;
    poolId: string | null;
  };
  timing: {
    startsAt: number;
    /** Seconds until kickoff; 0 once the game has started. */
    secondsToKickoff: number;
    frozenAt: number | null;
    resolvedAt: number | null;
  };
  /** Unix seconds this snapshot was computed. */
  computedAt: number;
}

// ─── Pure aggregation ────────────────────────────────────────────────────────

function toUnix(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

/** Volume + activity from indexed fills. Tolerates malformed raw strings. */
export function aggregateFills(
  fills: readonly FillRow[],
  nowSeconds: number,
): { volume: VolumeMetrics; activity: ActivityMetrics } {
  const cutoff = nowSeconds - DAY_SECONDS;
  const volume: VolumeMetrics = { totalUsdc: 0, usdc24h: 0, buyCount: 0, sellCount: 0 };
  const traders = new Set<string>();
  let fillCount24h = 0;
  let lastTradeAt: number | null = null;

  for (const f of fills) {
    const usdc = Number(f.usdcRaw) / USDC_SCALE;
    if (!Number.isFinite(usdc) || usdc < 0) continue;
    const t = toUnix(f.createdAt);
    volume.totalUsdc += usdc;
    if (t >= cutoff) {
      volume.usdc24h += usdc;
      fillCount24h += 1;
    }
    if (f.direction === "buy") volume.buyCount += 1;
    else if (f.direction === "sell") volume.sellCount += 1;
    traders.add(f.address.toLowerCase());
    if (lastTradeAt === null || t > lastTradeAt) lastTradeAt = t;
  }

  return {
    volume,
    activity: {
      fillCount: volume.buyCount + volume.sellCount,
      fillCount24h,
      uniqueTraders: traders.size,
      lastTradeAt,
    },
  };
}

/**
 * Price metrics from the recorded series (`rows` newest first, as the DB
 * fetch returns them) with the opening line as the pre-capture fallback.
 */
export function derivePriceMetrics(
  rows: readonly PriceRow[],
  openingProbability: string | null,
  nowSeconds: number,
): PriceMetrics {
  if (rows.length === 0) {
    const opening = openingProbability === null ? null : Number(openingProbability);
    const usable = opening !== null && Number.isFinite(opening);
    return {
      currentYesProbability: usable ? opening : null,
      source: usable ? "opening" : null,
      capturedAt: null,
      change24hBps: null,
      history: [],
      latestLiquidityRaw: null,
    };
  }

  const latest = rows[0];
  const current = Number(latest.impliedProbability);
  const cutoff = nowSeconds - DAY_SECONDS;

  // Newest-first: the first row at/older than the cutoff is the freshest
  // capture that is at least 24h old — the honest comparison point.
  let dayAgo: number | null = null;
  for (const r of rows) {
    if (toUnix(r.capturedAt) <= cutoff) {
      dayAgo = Number(r.impliedProbability);
      break;
    }
  }

  const history = rows
    .slice(0, HISTORY_POINTS)
    .map((r) => ({ t: toUnix(r.capturedAt), p: Number(r.impliedProbability) }))
    .reverse();

  return {
    currentYesProbability: current,
    source: latest.source,
    capturedAt: toUnix(latest.capturedAt),
    change24hBps: dayAgo === null ? null : Math.round((current - dayAgo) * 10_000),
    history,
    latestLiquidityRaw: latest.liquidityRaw,
  };
}

/** Open interest from Mantua's unredeemed position mirror. */
export function deriveOpenInterest(
  positions: readonly PositionRow[],
  yesSupply: number | null,
): OpenInterestMetrics {
  let yes = 0;
  let no = 0;
  let count = 0;
  for (const p of positions) {
    if (p.redeemedAt !== null) continue;
    const size = Number(p.size) / USDC_SCALE;
    if (!Number.isFinite(size) || size <= 0) continue;
    count += 1;
    if (p.side === "yes") yes += size;
    else if (p.side === "no") no += size;
  }
  return { yesTokensOpen: yes, noTokensOpen: no, openPositionCount: count, yesSupply };
}

export function secondsToKickoff(startsAtSeconds: number, nowSeconds: number): number {
  return Math.max(0, startsAtSeconds - nowSeconds);
}

/**
 * P-011 — the implied YES probability of one fill, as the `market_prices`
 * decimal string (0–1, 5dp): the trade's effective price `usdc / tokens`,
 * clamped into the contract's [0, 1] band (a thin book can execute a hair
 * outside it). Null for malformed or zero-token fills — an unpriceable
 * fill writes no tick rather than a fabricated one.
 */
export function fillImpliedProbability(usdcRaw: string, tokensRaw: string): string | null {
  const usdc = Number(usdcRaw);
  const tokens = Number(tokensRaw);
  if (!Number.isFinite(usdc) || !Number.isFinite(tokens) || tokens <= 0 || usdc < 0) return null;
  return Math.min(1, Math.max(0, usdc / tokens)).toFixed(5);
}

/**
 * P-011 — snapshot cadence guard, pure: a pool capture is due only when
 * the latest recorded `pool` tick for the market is at least
 * `minIntervalSeconds` old (or absent). This is what makes re-running the
 * sync cron idempotent-enough: back-to-back ticks cannot stack duplicate
 * snapshots, while the normal cadence records every pass.
 */
export function poolSnapshotDue(
  lastPoolCapturedAtMs: number | null,
  nowMs: number,
  minIntervalSeconds: number,
): boolean {
  if (lastPoolCapturedAtMs === null) return true;
  return nowMs - lastPoolCapturedAtMs >= minIntervalSeconds * 1000;
}

// ─── Best-effort on-chain reads (null on any failure) ────────────────────────

async function readYesSupply(yesToken: string | null, chainId: number): Promise<number | null> {
  if (yesToken === null || !isSupportedChainId(chainId)) return null;
  try {
    const supply = await getRpcClient(chainId).readContract({
      address: yesToken as `0x${string}`,
      abi: ERC20_SUPPLY_ABI,
      functionName: "totalSupply",
    });
    return Number(supply) / USDC_SCALE;
  } catch {
    return null; // RPC hiccup — a null metric, never an error
  }
}

async function readPoolLiquidity(poolId: string | null, chainId: number): Promise<string | null> {
  if (poolId === null || !isSupportedChainId(chainId)) return null;
  const periphery = MARKETS_PERIPHERY_BY_CHAIN[chainId];
  if (!periphery) return null; // market periphery not deployed — expected pre-launch
  try {
    const liquidity = await getRpcClient(chainId).readContract({
      address: periphery.stateView,
      abi: STATE_VIEW_ABI,
      functionName: "getLiquidity",
      args: [poolId as `0x${string}`],
    });
    return liquidity.toString();
  } catch {
    return null;
  }
}

async function readConcentration(yesToken: string | null): Promise<ConcentrationMetrics | null> {
  if (yesToken === null) return null;
  try {
    const { holders, top10Pct } = await getTokenHolders(yesToken, 10);
    if (holders.length === 0) return null;
    return {
      topHolderPct: Math.max(...holders.map((h) => h.pctOfSupply)),
      top10Pct,
      holdersListed: holders.length,
    };
  } catch {
    return null;
  }
}

// ─── Assembly ────────────────────────────────────────────────────────────────

const FILL_SCAN_LIMIT = 2_000;
const PRICE_SCAN_LIMIT = 500;

async function computeMarketMetrics(
  db: DB,
  marketId: string,
  nowSeconds: number,
): Promise<MarketMetrics | null> {
  const rows = await db
    .select({
      marketId: markets.marketId,
      state: markets.state,
      chainId: markets.chainId,
      outcomeIndex: markets.outcomeIndex,
      yesToken: markets.yesToken,
      poolId: markets.poolId,
      openingProbability: markets.openingProbability,
      frozenAt: markets.frozenAt,
      resolvedAt: markets.resolvedAt,
      providerEventId: events.providerEventId,
      homeTeam: events.homeTeam,
      awayTeam: events.awayTeam,
      startsAt: events.startsAt,
      eventStatus: events.status,
    })
    .from(markets)
    .innerJoin(events, eq(markets.eventId, events.id))
    .where(eq(markets.marketId, marketId))
    .limit(1);
  const row = rows.at(0);
  if (!row) return null;

  const [priceRows, fillRows, positionRows, yesSupply, poolLiquidity, concentration] =
    await Promise.all([
      db
        .select({
          impliedProbability: marketPrices.impliedProbability,
          source: marketPrices.source,
          liquidityRaw: marketPrices.liquidityRaw,
          capturedAt: marketPrices.capturedAt,
        })
        .from(marketPrices)
        .where(eq(marketPrices.marketId, marketId))
        .orderBy(desc(marketPrices.capturedAt))
        .limit(PRICE_SCAN_LIMIT),
      db
        .select({
          address: marketFills.address,
          direction: marketFills.direction,
          tokensRaw: marketFills.tokensRaw,
          usdcRaw: marketFills.usdcRaw,
          createdAt: marketFills.createdAt,
        })
        .from(marketFills)
        .where(eq(marketFills.marketId, marketId))
        .orderBy(desc(marketFills.createdAt))
        .limit(FILL_SCAN_LIMIT),
      db
        .select({
          side: marketPositions.side,
          size: marketPositions.size,
          redeemedAt: marketPositions.redeemedAt,
        })
        .from(marketPositions)
        .where(and(eq(marketPositions.marketId, marketId), isNull(marketPositions.redeemedAt))),
      readYesSupply(row.yesToken, row.chainId),
      readPoolLiquidity(row.poolId, row.chainId),
      readConcentration(row.yesToken),
    ]);

  const { volume, activity } = aggregateFills(fillRows, nowSeconds);
  const startsAt = toUnix(row.startsAt);

  return {
    marketId: row.marketId,
    state: row.state,
    chainId: row.chainId,
    outcomeIndex: row.outcomeIndex,
    event: {
      providerEventId: row.providerEventId,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      status: row.eventStatus,
      label: row.outcomeIndex === 0 ? row.homeTeam : row.awayTeam,
    },
    price: derivePriceMetrics(priceRows, row.openingProbability, nowSeconds),
    volume,
    activity,
    openInterest: deriveOpenInterest(positionRows, yesSupply),
    concentration,
    liquidity: { poolLiquidity, poolId: row.poolId },
    timing: {
      startsAt,
      secondsToKickoff: secondsToKickoff(startsAt, nowSeconds),
      frozenAt: row.frozenAt ? toUnix(row.frozenAt) : null,
      resolvedAt: row.resolvedAt ? toUnix(row.resolvedAt) : null,
    },
    computedAt: nowSeconds,
  };
}

/** Short-TTL snapshot cache — the route is authless and rate-limit-light,
 *  so bursts of identical reads must collapse into one computation. */
const METRICS_TTL_MS = 15_000;
const metricsCache = new TtlCache<MarketMetrics | null>();

/**
 * Metrics snapshot for one market. Null when the market id is unknown to
 * Mantua's records (cached briefly too, so probing can't stampede).
 */
export async function getMarketMetrics(
  marketId: string,
  db: DB = defaultDb,
): Promise<MarketMetrics | null> {
  return metricsCache.get(
    marketId.toLowerCase(),
    () => computeMarketMetrics(db, marketId, Math.floor(Date.now() / 1000)),
    METRICS_TTL_MS,
  );
}

/** Batch cap mirrors the Polymarket-conventions batch-read guidance. */
export const METRICS_BATCH_LIMIT = 50;

/**
 * Batch variant: metrics for up to {@link METRICS_BATCH_LIMIT} markets,
 * keyed by market id; unknown ids are omitted rather than fabricated.
 * A single failing market is skipped (logged), not fatal to the batch.
 */
// ─── P-011: periodic pool-price snapshots (the sync cron's pass) ────────────

/** Minimum spacing between recorded `pool` ticks per market. The sync cron
 *  ticks every few minutes; 60s means a normal cadence always records and a
 *  re-run (or overlapping invocation) cannot stack duplicates. */
export const POOL_SNAPSHOT_MIN_INTERVAL_SECONDS = 60;

/** How many OPEN pools one pass will read — fan-out bound, not a quota. */
const SNAPSHOT_SCAN_LIMIT = 200;

export interface PoolSnapshotSummary {
  scanned: number;
  written: number;
  /** Skipped because a fresh-enough `pool` tick already exists (dedupe). */
  skippedFresh: number;
  /** Skipped because the pool has no readable price yet (uninitialized). */
  skippedUnpriced: number;
  failures: { marketId: string; error: string }[];
}

/**
 * Record one `market_prices` row per OPEN market with a live pool — the
 * periodic half of P-011's tick recording (the fill path writes the other
 * half). Reads the pool price exactly the way the metrics/live-odds reads
 * do (StateView `getSlot0` → implied probability, clamped to [0, 1]);
 * liquidity rides along best-effort. Returns null when the market stack is
 * not deployed on the chain — the cron degrades to planning, same as every
 * other on-chain pass.
 */
export async function snapshotMarketPoolPrices(
  db: DB = defaultDb,
  chainId = 8453,
  nowMs: number = Date.now(),
): Promise<PoolSnapshotSummary | null> {
  if (!isSupportedChainId(chainId)) return null;
  const deployment = MARKETS_BY_CHAIN[chainId];
  const periphery = MARKETS_PERIPHERY_BY_CHAIN[chainId];
  if (!deployment || !periphery) return null; // pre-deployment — expected
  const client = getRpcClient(chainId);

  const rows = await db
    .select({ marketId: markets.marketId, yesToken: markets.yesToken, poolId: markets.poolId })
    .from(markets)
    .where(
      and(
        eq(markets.chainId, chainId),
        eq(markets.state, "OPEN"),
        isNotNull(markets.poolId),
        isNotNull(markets.yesToken),
      ),
    )
    .limit(SNAPSHOT_SCAN_LIMIT);

  const summary: PoolSnapshotSummary = {
    scanned: rows.length,
    written: 0,
    skippedFresh: 0,
    skippedUnpriced: 0,
    failures: [],
  };
  if (rows.length === 0) return summary;

  // Dedupe: the freshest recorded `pool` tick per market, one query.
  const latest = await db
    .select({
      marketId: marketPrices.marketId,
      capturedAt: sql<Date | string | null>`max(${marketPrices.capturedAt})`,
    })
    .from(marketPrices)
    .where(
      and(
        inArray(
          marketPrices.marketId,
          rows.map((r) => r.marketId),
        ),
        eq(marketPrices.source, "pool"),
      ),
    )
    .groupBy(marketPrices.marketId);
  const latestByMarket = new Map<string, number>();
  for (const l of latest) {
    const t = l.capturedAt instanceof Date ? l.capturedAt.getTime() : Date.parse(String(l.capturedAt));
    if (Number.isFinite(t)) latestByMarket.set(l.marketId, t);
  }

  for (const row of rows) {
    if (!row.poolId || !row.yesToken) continue;
    if (
      !poolSnapshotDue(
        latestByMarket.get(row.marketId) ?? null,
        nowMs,
        POOL_SNAPSHOT_MIN_INTERVAL_SECONDS,
      )
    ) {
      summary.skippedFresh += 1;
      continue;
    }
    try {
      const [sqrtPriceX96] = await client.readContract({
        address: periphery.stateView,
        abi: STATE_VIEW_ABI,
        functionName: "getSlot0",
        args: [row.poolId as `0x${string}`],
      });
      if (sqrtPriceX96 === 0n) {
        summary.skippedUnpriced += 1; // pool not initialized yet
        continue;
      }
      // Token ordering in v4 is by address; the collateral side fixes it.
      const yesIsToken0 = row.yesToken.toLowerCase() < deployment.collateral.toLowerCase();
      const raw = sqrtPriceX96ToRawProbability(sqrtPriceX96, yesIsToken0);
      const probability = Math.min(1, Math.max(0, raw)).toFixed(5);
      const liquidity = await readPoolLiquidity(row.poolId, chainId); // best-effort null
      await db.insert(marketPrices).values({
        marketId: row.marketId,
        impliedProbability: probability,
        source: "pool",
        liquidityRaw: liquidity,
        capturedAt: new Date(nowMs),
      });
      summary.written += 1;
    } catch (err) {
      summary.failures.push({
        marketId: row.marketId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

export async function getMarketMetricsBatch(
  marketIds: readonly string[],
  db: DB = defaultDb,
): Promise<Record<string, MarketMetrics>> {
  const known = await db
    .select({ marketId: markets.marketId })
    .from(markets)
    .where(inArray(markets.marketId, [...new Set(marketIds)].slice(0, METRICS_BATCH_LIMIT)));

  const out: Record<string, MarketMetrics> = {};
  await Promise.all(
    known.map(async ({ marketId }) => {
      try {
        const metrics = await getMarketMetrics(marketId, db);
        if (metrics) out[marketId] = metrics;
      } catch (err) {
        logger.warn({ err, marketId }, "market-metrics: batch entry failed — skipping");
      }
    }),
  );
  return out;
}
