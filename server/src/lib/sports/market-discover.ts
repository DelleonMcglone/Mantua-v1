/**
 * Task 050 (T-018 / T-020) — the discover read: public slates joined to
 * per-market liquidity and popularity, flattened into one id-free list.
 *
 * Structure mirrors market-metrics.ts: pure `aggregate*` / `compose*`
 * functions over plain row shapes (unit-tested, no DB) and a thin DB
 * assembly. Liquidity is the latest recorded pool tick's `liquidityRaw`
 * (P-011 snapshots); popularity is 24 h fill volume + count. A market with
 * no on-chain leg reports zeros, never nulls — the consumer layer sorts on
 * them.
 */
import type { PublicEvent, PublicSlate } from "./public-slate.ts";

const USDC_SCALE = 1e6;
export const DAY_MS = 86_400_000;

export interface DiscoverAggregate {
  liquidityRaw: string | null;
  volume24hRaw: bigint;
  fills24h: number;
}

/** What leaves the server — `features/markets/discovery.ts` mirrors it. */
export interface DiscoverMarketWire extends PublicEvent {
  league: string;
  tradeable: boolean;
  liquidityUsdc: number;
  volume24hUsdc: number;
  fills24h: number;
}

export interface DiscoverRead {
  markets: DiscoverMarketWire[];
  fetchedAt: number;
  dataAsOf?: number;
  delayed: boolean;
}

/**
 * Approximate dollar value of a full-range YES/USDC position with
 * liquidity `L` at price `p`: reserves are `L·√p` USDC and `L/√p` YES worth
 * `p` each, so the pool holds `2·L·√p`. Market pools are seeded full-range
 * (markets-onchain.ts `SEED_TICK`), so this is what a trader can lean on.
 */
export function poolLiquidityUsdc(
  liquidityRaw: string | null,
  probabilityBps: number | undefined,
): number {
  if (liquidityRaw === null || probabilityBps === undefined) return 0;
  const l = Number(liquidityRaw);
  if (!Number.isFinite(l) || l <= 0) return 0;
  const p = Math.min(1, Math.max(0, probabilityBps / 10_000));
  return (2 * l * Math.sqrt(p)) / USDC_SCALE;
}

export interface DiscoverFillRow {
  marketId: string;
  usdcRaw: string;
  createdAt: Date;
}

/** 24 h volume + fill count per market. Tolerates malformed raw strings. */
export function aggregateDiscoverFills(
  fills: readonly DiscoverFillRow[],
  nowMs: number,
): Map<string, { volume24hRaw: bigint; fills24h: number }> {
  const out = new Map<string, { volume24hRaw: bigint; fills24h: number }>();
  const cutoff = nowMs - DAY_MS;
  for (const f of fills) {
    if (f.createdAt.getTime() < cutoff || !/^\d+$/.test(f.usdcRaw)) continue;
    const cur = out.get(f.marketId) ?? { volume24hRaw: 0n, fills24h: 0 };
    cur.volume24hRaw += BigInt(f.usdcRaw);
    cur.fills24h += 1;
    out.set(f.marketId, cur);
  }
  return out;
}

function isTradableStatus(status: string): boolean {
  return status === "scheduled" || status === "in_progress";
}

/** Slates + aggregates (keyed by providerEventId) → the discover read. */
export function composeDiscoverMarkets(
  slates: readonly PublicSlate[],
  aggregates: ReadonlyMap<string, DiscoverAggregate>,
): DiscoverRead {
  const markets: DiscoverMarketWire[] = [];
  let fetchedAt = 0;
  let dataAsOf: number | undefined;
  let delayed = false;
  for (const slate of slates) {
    fetchedAt = fetchedAt === 0 ? slate.fetchedAt : Math.min(fetchedAt, slate.fetchedAt);
    if (slate.dataAsOf !== undefined)
      dataAsOf = Math.min(dataAsOf ?? slate.dataAsOf, slate.dataAsOf);
    delayed = delayed || slate.delayed;
    for (const event of slate.events) {
      const agg = aggregates.get(event.providerEventId);
      markets.push({
        ...event,
        league: slate.league,
        tradeable: Boolean(event.liveOdds) && isTradableStatus(event.status),
        liquidityUsdc: poolLiquidityUsdc(agg?.liquidityRaw ?? null, event.homeWinProbabilityBps),
        volume24hUsdc: agg ? Number(agg.volume24hRaw) / USDC_SCALE : 0,
        fills24h: agg?.fills24h ?? 0,
      });
    }
  }
  return { markets, fetchedAt, ...(dataAsOf !== undefined ? { dataAsOf } : {}), delayed };
}
