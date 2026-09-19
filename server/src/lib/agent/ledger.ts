import { createHash } from "node:crypto";
import {
  executionModeOf,
  LEDGER_MODES,
  type AuditAttribution,
  type LedgerMode,
} from "./execution-mode.ts";
import { computePerformance, type MarketRow, type ResolutionRow } from "./performance.ts";

/**
 * Task 070 / AE-011, AE-013, AE-014 — the canonical agent ledger.
 *
 * Derived, never declared: entries come from chain-verified fills, market
 * resolutions and the audit trail. Every fill is listed with the mode it
 * executed under; simulations (no capital moved) are reported in their own
 * block and never enter P&L; a digest over every entry lets two readers
 * prove they saw the same history. There is deliberately no parameter
 * that filters by outcome — a loss cannot be left out.
 */

export type {
  AgentLedger,
  LedgerFill,
  LedgerMarket,
  LedgerTrade,
  ModeTotals,
  SimulationRow,
} from "./ledger-types.ts";
import type {
  AgentLedger,
  LedgerFill,
  LedgerMarket,
  LedgerTrade,
  ModeTotals,
  SimulationRow,
} from "./ledger-types.ts";

const round2 = (n: number): number => Number(n.toFixed(2));
const usd = (raw: string): number => Number(raw) / 1e6;

function emptyModeTotals(): Record<LedgerMode, ModeTotals> {
  const out = {} as Record<LedgerMode, ModeTotals>;
  for (const m of LEDGER_MODES) out[m] = { trades: 0, stakedUsd: 0, realizedPnlUsd: 0, markets: 0 };
  return out;
}

/** SHA-256 over the sorted set of fill hashes and simulation ids. */
export function ledgerDigest(
  fills: readonly { txHash: string }[],
  simulations: readonly { id: string }[],
): string {
  const ids = [
    ...fills.map((f) => `f:${f.txHash.toLowerCase()}`),
    ...simulations.map((s) => `s:${s.id}`),
  ].sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex");
}

/** Pure: the ledger for one wallet from the records that define it. */
export function buildLedger(
  address: string,
  fills: readonly LedgerFill[],
  marketRows: readonly MarketRow[],
  resolutionRows: readonly ResolutionRow[],
  auditByTx: ReadonlyMap<string, AuditAttribution>,
  simulations: readonly SimulationRow[],
): AgentLedger {
  const modeByTx = new Map<string, LedgerMode>();
  const trades: LedgerTrade[] = fills.map((f) => {
    const mode = executionModeOf(auditByTx.get(f.txHash.toLowerCase()));
    modeByTx.set(f.txHash.toLowerCase(), mode);
    const tokens = usd(f.tokensRaw);
    return {
      txHash: f.txHash,
      marketId: f.marketId,
      direction: f.direction,
      tokens,
      usdc: usd(f.usdcRaw),
      priceBps: tokens > 0 ? Math.round((Number(f.usdcRaw) / Number(f.tokensRaw)) * 10_000) : null,
      mode,
      at: f.createdAt.toISOString(),
    };
  });
  trades.sort((a, b) => b.at.localeCompare(a.at));

  const perf = computePerformance(address, fills, marketRows, resolutionRows);
  const resolvedAtOf = new Map(marketRows.map((m) => [m.marketId, m.resolvedAt]));
  const byMode = emptyModeTotals();
  let mixedMarkets = 0;
  const markets: LedgerMarket[] = perf.markets.map((m) => {
    const modes = [...new Set(trades.filter((x) => x.marketId === m.marketId).map((x) => x.mode))];
    const single = modes.length === 1 ? modes[0] : null;
    if (single) {
      byMode[single].markets += 1;
      if (m.status !== "open") byMode[single].realizedPnlUsd += m.realizedPnlUsd ?? 0;
    } else if (m.status !== "open") mixedMarkets += 1;
    return { ...m, modes, resolvedAt: resolvedAtOf.get(m.marketId)?.toISOString() ?? null };
  });
  for (const x of trades) {
    byMode[x.mode].trades += 1;
    if (x.direction === "buy") byMode[x.mode].stakedUsd += x.usdc;
  }
  for (const m of LEDGER_MODES) {
    byMode[m].stakedUsd = round2(byMode[m].stakedUsd);
    byMode[m].realizedPnlUsd = round2(byMode[m].realizedPnlUsd);
  }

  const latestSim = simulations.reduce<Date | null>(
    (acc, s) => (acc === null || s.createdAt > acc ? s.createdAt : acc),
    null,
  );
  return {
    address,
    digest: ledgerDigest(fills, simulations),
    trades,
    markets,
    totals: perf.totals,
    byMode,
    mixedMarkets,
    simulated: {
      count: simulations.length,
      executable: simulations.filter((s) => s.executable).length,
      notionalUsd: round2(simulations.reduce((acc, s) => acc + (s.valueUsd ?? 0), 0)),
      latestAt: latestSim?.toISOString() ?? null,
    },
  };
}
