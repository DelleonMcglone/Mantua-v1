import { desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { marketFills, markets, resolutions } from "../../db/schema/markets.ts";
import { mantuaAuditLog } from "../../db/schema/safety.ts";

/**
 * Phase 8 / A-016 — the agent's performance: realized P&L and win rate
 * from its own indexed fills and the markets' resolutions. Pure over
 * rows so the arithmetic is unit-tested; `readAgentPerformance` feeds it
 * from the database for one wallet address.
 *
 * Accounting (6-decimal raw units, YES tokens redeem at 1 USDC):
 *   cost      = Σ usdc of buys
 *   proceeds  = Σ usdc of sells
 *   held      = Σ tokens bought − Σ tokens sold (never below zero)
 *   payout    = held × 1 USDC when the market resolved to this side, else 0
 *   realized  = proceeds + payout − cost, for RESOLVED markets
 *   open cost = cost − proceeds for markets still open (mark comes from
 *               `readMarketPositions`, not here)
 *   win       = a resolved market where realized > 0
 */

export interface FillRow {
  marketId: string;
  direction: string;
  tokensRaw: string;
  usdcRaw: string;
  createdAt: Date;
  txHash?: string;
}

/** A-039 — who moved the money: the chat agent, the hedge engine, or the user's own ticket. */
export type FillSource = "agent_chat" | "hedge_strategy" | "user";

/** Map an audit action recorded against a fill's tx hash to its source. */
export function sourceOfAction(action: string | undefined): FillSource {
  if (action === "agent_market_trade") return "agent_chat";
  if (action === "strategy_execute" || action === "strategy_close") return "hedge_strategy";
  return "user";
}

export interface MarketRow {
  marketId: string;
  outcomeIndex: number;
  state: string;
  resolvedAt: Date | null;
}

export interface ResolutionRow {
  marketId: string;
  winningOutcomeIndex: number | null;
  method: string;
}

export interface MarketPerformance {
  marketId: string;
  outcomeIndex: number;
  status: "resolved_win" | "resolved_loss" | "voided" | "open";
  /** Distinct sources of this market's fills (A-039 attribution). */
  attribution: FillSource[];
  costUsd: number;
  proceedsUsd: number;
  payoutUsd: number;
  realizedPnlUsd: number | null;
  tokensHeld: number;
  trades: number;
  firstTradeAt: string;
  lastTradeAt: string;
}

export interface AgentPerformance {
  address: string;
  markets: MarketPerformance[];
  totals: {
    resolvedMarkets: number;
    wins: number;
    losses: number;
    voided: number;
    /** wins / (wins + losses), null before any resolved market. */
    winRate: number | null;
    realizedPnlUsd: number;
    /** Cost still at risk in open markets (before mark). */
    openCostUsd: number;
    openMarkets: number;
    trades: number;
    /** Realized P&L / cost of resolved markets; null when no cost. */
    returnOnResolvedCost: number | null;
    /** Trades by source (A-039). */
    bySource: Record<FillSource, number>;
  };
}

const USDC = 1e6;
function usd(raw: bigint): number {
  return Number(raw) / USDC;
}
function round2(n: number): number {
  return Number(n.toFixed(2));
}

/** Pure: per-market ledgers and totals. */
export function computePerformance(
  address: string,
  fills: readonly FillRow[],
  marketRows: readonly MarketRow[],
  resolutionRows: readonly ResolutionRow[],
  /** txHash → audit action, for attribution; absent = user ticket. */
  actionsByTx: ReadonlyMap<string, string> = new Map(),
): AgentPerformance {
  const bySource: Record<FillSource, number> = { agent_chat: 0, hedge_strategy: 0, user: 0 };
  const byMarket = new Map<string, FillRow[]>();
  for (const f of fills) {
    const list = byMarket.get(f.marketId) ?? [];
    list.push(f);
    byMarket.set(f.marketId, list);
  }
  const marketInfo = new Map(marketRows.map((m) => [m.marketId, m]));
  // Latest resolution per market wins (the rows arrive newest first).
  const resolution = new Map<string, ResolutionRow>();
  for (const r of resolutionRows) if (!resolution.has(r.marketId)) resolution.set(r.marketId, r);

  const out: MarketPerformance[] = [];
  for (const [marketId, list] of byMarket) {
    let cost = 0n;
    let proceeds = 0n;
    let bought = 0n;
    let sold = 0n;
    let first = list[0].createdAt;
    let last = first;
    const sources = new Set<FillSource>();
    for (const f of list) {
      const src = sourceOfAction(f.txHash ? actionsByTx.get(f.txHash.toLowerCase()) : undefined);
      sources.add(src);
      bySource[src] += 1;
      const tokens = BigInt(f.tokensRaw);
      const usdc = BigInt(f.usdcRaw);
      if (f.direction === "buy") {
        cost += usdc;
        bought += tokens;
      } else {
        proceeds += usdc;
        sold += tokens;
      }
      if (f.createdAt < first) first = f.createdAt;
      if (f.createdAt > last) last = f.createdAt;
    }
    const held = bought > sold ? bought - sold : 0n;
    const m = marketInfo.get(marketId);
    const r = resolution.get(marketId);
    const outcomeIndex = m?.outcomeIndex ?? -1;
    let status: MarketPerformance["status"] = "open";
    let payout = 0n;
    if (r && (r.method === "void" || r.winningOutcomeIndex === null)) {
      status = "voided";
      // A void refunds the collateral behind held tokens at par.
      payout = held;
    } else if (r && m) {
      const won = r.winningOutcomeIndex === m.outcomeIndex;
      payout = won ? held : 0n;
      const realized = proceeds + payout - cost;
      status = realized > 0n ? "resolved_win" : "resolved_loss";
    }
    const realized = status === "open" ? null : round2(usd(proceeds + payout - cost));
    out.push({
      marketId,
      outcomeIndex,
      status,
      attribution: [...sources],
      costUsd: round2(usd(cost)),
      proceedsUsd: round2(usd(proceeds)),
      payoutUsd: round2(usd(payout)),
      realizedPnlUsd: realized,
      tokensHeld: round2(usd(held)),
      trades: list.length,
      firstTradeAt: first.toISOString(),
      lastTradeAt: last.toISOString(),
    });
  }
  out.sort((a, b) => b.lastTradeAt.localeCompare(a.lastTradeAt));

  let wins = 0;
  let losses = 0;
  let voided = 0;
  let realizedPnl = 0;
  let resolvedCost = 0;
  let openCost = 0;
  let openMarkets = 0;
  let trades = 0;
  for (const m of out) {
    trades += m.trades;
    if (m.status === "open") {
      openMarkets += 1;
      openCost += Math.max(0, m.costUsd - m.proceedsUsd);
      continue;
    }
    realizedPnl += m.realizedPnlUsd ?? 0;
    resolvedCost += m.costUsd;
    if (m.status === "resolved_win") wins += 1;
    else if (m.status === "resolved_loss") losses += 1;
    else voided += 1;
  }
  const decided = wins + losses;
  return {
    address,
    markets: out,
    totals: {
      resolvedMarkets: wins + losses + voided,
      wins,
      losses,
      voided,
      winRate: decided === 0 ? null : Number((wins / decided).toFixed(4)),
      realizedPnlUsd: round2(realizedPnl),
      openCostUsd: round2(openCost),
      openMarkets,
      trades,
      returnOnResolvedCost:
        resolvedCost === 0 ? null : Number((realizedPnl / resolvedCost).toFixed(4)),
      bySource,
    },
  };
}

/** Production reader: this wallet's fills, their markets, and the latest resolutions. */
export async function readAgentPerformance(db: DB, address: string): Promise<AgentPerformance> {
  const fills = await db
    .select({
      marketId: marketFills.marketId,
      direction: marketFills.direction,
      tokensRaw: marketFills.tokensRaw,
      usdcRaw: marketFills.usdcRaw,
      createdAt: marketFills.createdAt,
      txHash: marketFills.txHash,
    })
    .from(marketFills)
    .where(eq(marketFills.address, address.toLowerCase()));
  const ids = [...new Set(fills.map((f) => f.marketId))];
  if (ids.length === 0) return computePerformance(address, [], [], []);
  const txHashes = fills.map((f) => f.txHash.toLowerCase());
  const [marketRows, resolutionRows, auditRows] = await Promise.all([
    db
      .select({
        marketId: markets.marketId,
        outcomeIndex: markets.outcomeIndex,
        state: markets.state,
        resolvedAt: markets.resolvedAt,
      })
      .from(markets)
      .where(inArray(markets.marketId, ids)),
    db
      .select({
        marketId: resolutions.marketId,
        winningOutcomeIndex: resolutions.winningOutcomeIndex,
        method: resolutions.method,
        createdAt: resolutions.createdAt,
      })
      .from(resolutions)
      .where(inArray(resolutions.marketId, ids))
      .orderBy(desc(resolutions.createdAt)),
    db
      .select({ txHash: mantuaAuditLog.txHash, action: mantuaAuditLog.action })
      .from(mantuaAuditLog)
      .where(inArray(mantuaAuditLog.txHash, txHashes)),
  ]);
  const actionsByTx = new Map<string, string>();
  for (const r of auditRows) if (r.txHash) actionsByTx.set(r.txHash.toLowerCase(), r.action);
  return computePerformance(address, fills, marketRows, resolutionRows, actionsByTx);
}
