/**
 * Wire shapes for the market page (mirror server/src/routes/market-detail.ts
 * and market-positions.ts), shared by the detail tabs.
 */
import type { PricePoint } from "../market-movement.ts";

export type { PricePoint };

export interface ActivityRow {
  t: number;
  address: string;
  direction: string;
  outcomeIndex: number;
  usdc: number;
  tokens: number;
  txHash: string;
  /** D-105 fee the trade paid (H-011); null for fills recorded without it. */
  feeUsdc: number | null;
  playoffs: boolean | null;
}

export interface HolderRow {
  address: string;
  isContract: boolean;
  label: string | null;
  balance: string;
  pctOfSupply: number;
}

export interface OutcomeHolders {
  outcomeIndex: number;
  holders: HolderRow[];
  top10Pct: number;
}

export interface DetailResponse {
  hasMarkets: boolean;
  prices: PricePoint[];
  activity: ActivityRow[];
  holders: OutcomeHolders[];
}

export interface Comment {
  id: string;
  address: string;
  body: string;
  t: number;
}

export interface PositionRow {
  marketId: string;
  label: string;
  state: string;
  side: "yes" | "no";
  balance: string;
  impliedProbBps: number | null;
  valueRaw: string;
  league: string | null;
  providerEventId: string | null;
  entryPriceBps: number | null;
  pnlRaw: string | null;
}

/** Short handle for another trader — deeper-data surfaces only. */
export function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
