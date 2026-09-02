/**
 * Phase 4 — pool data shapes returned by the server. Mirror of the
 * /api/pools and /api/pools/:id response envelopes.
 */

export interface PoolSummary {
  id: string;
  symbol: string;
  project: string;
  feeTier: string | null;
  tvlUsd: number;
  apy: number;
  volumeUsd1d: number;
  volumeUsd7d: number;
  underlyingTokens: string[];
  stablecoin: boolean;
}

export interface PoolDetail {
  pool: Omit<PoolSummary, "stablecoin">;
  chart: PoolChartPoint[];
}

export interface PoolChartPoint {
  /** Unix seconds (lightweight-charts format). */
  time: number;
  tvlUsd: number;
  apy: number;
}

export type ChartRange = "1D" | "7D" | "30D" | "90D" | "1Y" | "ALL";
