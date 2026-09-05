/**
 * B7-006 — pool↔market linkage for the pool list, mirrored from
 * GET /api/markets/pools. Pure shapes + join helpers (UI-agnostic and
 * unit-tested); the fetch lives in use-market-pools.ts.
 *
 * The edge case that shapes this module: the market-status column joins
 * the pool list ONLY when markets exist. With no deployed markets the
 * server returns `pools: []` and every helper here reports "no column" —
 * absent, not empty.
 */

/** Market lifecycle states — mirrors `markets.state` server-side. */
export type MarketState = "OPEN" | "FROZEN" | "RESOLVED" | "SETTLED" | "INVALID";

export interface MarketPoolInfo {
  marketId: string;
  /** v4 PoolId (0x…32-byte hash) of the market's YES/USDC pool. */
  poolId: string;
  state: string;
  outcomeIndex: number;
  chainId: number;
  providerEventId: string;
  /** The team whose YES this pool prices. */
  label: string;
  /** "Away @ Home" display line for the pair cell. */
  event: string;
  /** Kickoff, unix seconds. */
  startsAt: number;
  /** League slug (e.g. "nfl") — drives the B7-007 league filter. */
  league: string;
  /** Sport slug (e.g. "football") — drives the B7-007 sport filter. */
  sport: string;
}

/**
 * B7-004 — how a market pool is addressed by the liquidity surface: the
 * game + outcome key (the market-trade convention), plus optional display
 * context. Carried in the add-liquidity route context.
 */
export interface MarketLiquidityTarget {
  providerEventId: string;
  outcomeIndex: 0 | 1;
  /** Display label for the YES side (the team). */
  label?: string;
  /** "Away @ Home" event line. */
  event?: string;
}

export interface MarketPoolsResponse {
  /** Whether the Dynamic Market stack is configured on this chain —
   *  the liquidity surface's gate for market-pool actions (B7-004). */
  marketsDeployed: boolean;
  pools: MarketPoolInfo[];
}

/** Human label per market state. Unknown states pass through verbatim. */
export function marketStatusLabel(state: string): string {
  switch (state) {
    case "OPEN":
      return "Open";
    case "FROZEN":
      return "Frozen";
    case "RESOLVED":
      return "Resolved";
    case "SETTLED":
      return "Settled";
    case "INVALID":
      return "Void";
    default:
      return state;
  }
}

/** Badge tone per state — keys into the list page's tint classes. */
export function marketStatusTone(state: string): "live" | "paused" | "done" {
  switch (state) {
    case "OPEN":
      return "live";
    case "FROZEN":
      return "paused";
    default:
      return "done";
  }
}

/**
 * Index market pools by their v4 poolId (lowercased) so pool rows can
 * join their market status in O(1).
 */
export function indexMarketPools(pools: MarketPoolInfo[]): Map<string, MarketPoolInfo> {
  const map = new Map<string, MarketPoolInfo>();
  for (const p of pools) map.set(p.poolId.toLowerCase(), p);
  return map;
}

/**
 * B7-006 edge case: render the market-status column only when at least
 * one market pool exists. No markets → the column is absent entirely.
 */
export function showMarketStatusColumn(pools: MarketPoolInfo[] | null | undefined): boolean {
  return Array.isArray(pools) && pools.length > 0;
}
