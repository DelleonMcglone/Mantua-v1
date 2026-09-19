/**
 * Task 070 / AE-012 — the wire shape of `GET /api/agents/:handle`, as the
 * public page consumes it. Mirrors `server/src/routes/agents-public.ts`.
 */

export const LEDGER_MODES = ["simulated", "user_confirmed", "autonomous", "unattributed"] as const;
export type LedgerMode = (typeof LEDGER_MODES)[number];

export interface PublicTrade {
  txHash: string;
  marketId: string;
  direction: string;
  tokens: number;
  usdc: number;
  priceBps: number | null;
  mode: LedgerMode;
  at: string;
}

export interface PublicMarket {
  marketId: string;
  status: "resolved_win" | "resolved_loss" | "voided" | "open";
  modes: LedgerMode[];
  costUsd: number;
  proceedsUsd: number;
  payoutUsd: number;
  realizedPnlUsd: number | null;
  trades: number;
  resolvedAt: string | null;
  lastTradeAt: string;
}

export interface ModeTotals {
  trades: number;
  stakedUsd: number;
  realizedPnlUsd: number;
  markets: number;
}

export interface PublicAgent {
  handle: string;
  displayName: string;
  bio: string;
  walletAddress: string;
  platform: string;
  ledger: {
    digest: string;
    trades: PublicTrade[];
    markets: PublicMarket[];
    byMode: Record<LedgerMode, ModeTotals>;
    mixedMarkets: number;
    simulated: { count: number; executable: number; notionalUsd: number; latestAt: string | null };
    totals: { wins: number; losses: number; voided: number; trades: number; openMarkets: number };
  };
  metrics: {
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    capitalDeployedUsd: number;
    roi: number | null;
    winRate: number | null;
    maxDrawdownUsd: number;
    maxDrawdownPct: number | null;
    exposure: { openCostUsd: number; markValueUsd: number; openMarkets: number };
    risk: {
      largestStakeUsd: number;
      largestStakeShare: number | null;
      largestLossUsd: number;
      profitFactor: number | null;
      avgStakeUsd: number;
    };
  };
  marksAvailable: boolean;
  computedAt: string;
  posts: {
    id: string;
    template: string;
    marketId: string | null;
    text: string;
    postedAt: string;
    externalId: string | null;
  }[];
}
