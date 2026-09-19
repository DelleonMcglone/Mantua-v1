import type { LedgerMode } from "./execution-mode.ts";
import type { AgentPerformance, FillRow, MarketPerformance } from "./performance.ts";

/**
 * Task 070 / AE-011 — the shapes of the canonical ledger (`ledger.ts`
 * builds them). Kept apart so the public route and the client can name
 * them without pulling in the computation.
 */

export interface LedgerFill extends FillRow {
  txHash: string;
}

/** One `agent_simulation` activity row for the agent's owner. */
export interface SimulationRow {
  id: string;
  marketId: string | null;
  valueUsd: number | null;
  executable: boolean;
  createdAt: Date;
}

export interface LedgerTrade {
  txHash: string;
  marketId: string;
  direction: string;
  tokens: number;
  usdc: number;
  /** Effective YES price of the fill, bps; null when no tokens moved. */
  priceBps: number | null;
  mode: LedgerMode;
  at: string;
}

export interface LedgerMarket extends MarketPerformance {
  modes: LedgerMode[];
  resolvedAt: string | null;
}

export interface ModeTotals {
  trades: number;
  stakedUsd: number;
  /** Realised P&L of resolved markets whose fills all share this mode. */
  realizedPnlUsd: number;
  markets: number;
}

export interface AgentLedger {
  address: string;
  digest: string;
  trades: LedgerTrade[];
  markets: LedgerMarket[];
  totals: AgentPerformance["totals"];
  byMode: Record<LedgerMode, ModeTotals>;
  /** Resolved markets whose fills span more than one mode. */
  mixedMarkets: number;
  simulated: { count: number; executable: number; notionalUsd: number; latestAt: string | null };
}
