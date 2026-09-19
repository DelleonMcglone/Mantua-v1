/**
 * Task 070 / AE-011 — the metric block of the canonical ledger, computed
 * from per-market rows and the live marks. Pure so every figure on the
 * public page is pinned by a unit test.
 *
 *   realised    Σ realised P&L of resolved markets (voids contribute 0)
 *   unrealised  Σ mark P&L of open positions (from the marked positions)
 *   deployed    Σ cost of every market ever entered (buys, before sells)
 *   ROI         realised / deployed
 *   drawdown    deepest peak-to-trough fall of cumulative realised P&L,
 *               ordered by resolution time
 *   exposure    open cost still at risk, and its current mark
 *   risk        largest single stake and its share of deployed capital,
 *               largest loss, profit factor (gross wins / gross losses),
 *               average stake
 */

export interface MetricMarket {
  marketId: string;
  status: "resolved_win" | "resolved_loss" | "voided" | "open";
  costUsd: number;
  proceedsUsd: number;
  realizedPnlUsd: number | null;
  resolvedAt: string | null;
}

/** The live mark of one open position (from `readMarketPositions`). */
export interface PositionMark {
  marketId: string;
  valueUsd: number;
  pnlUsd: number | null;
}

export interface LedgerMetrics {
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  capitalDeployedUsd: number;
  roi: number | null;
  wins: number;
  losses: number;
  voided: number;
  winRate: number | null;
  maxDrawdownUsd: number;
  /** Drawdown as a share of capital deployed; null before any capital. */
  maxDrawdownPct: number | null;
  exposure: { openCostUsd: number; markValueUsd: number; openMarkets: number };
  risk: {
    largestStakeUsd: number;
    largestStakeShare: number | null;
    largestLossUsd: number;
    profitFactor: number | null;
    avgStakeUsd: number;
  };
}

const round2 = (n: number): number => Number(n.toFixed(2));
const round4 = (n: number): number => Number(n.toFixed(4));

/**
 * Deepest fall from a running peak of the cumulative sum of `pnls`. Equity
 * starts at zero, so a first loss is already a fall. `peakUsd` is the
 * highest cumulative P&L reached.
 */
export function maxDrawdown(pnls: readonly number[]): { usd: number; peakUsd: number } {
  let cumulative = 0;
  let peak = 0;
  let worst = 0;
  for (const p of pnls) {
    cumulative += p;
    if (cumulative > peak) peak = cumulative;
    worst = Math.max(worst, peak - cumulative);
  }
  return { usd: round2(worst), peakUsd: round2(peak) };
}

/** Pure: every metric from the market rows and the open-position marks. */
export function computeLedgerMetrics(
  markets: readonly MetricMarket[],
  marks: readonly PositionMark[],
): LedgerMetrics {
  const resolved = markets
    .filter((m) => m.status !== "open")
    .sort((a, b) => (a.resolvedAt ?? "").localeCompare(b.resolvedAt ?? ""));
  const open = markets.filter((m) => m.status === "open");

  let realized = 0;
  let grossWins = 0;
  let grossLosses = 0;
  let largestLoss = 0;
  let wins = 0;
  let losses = 0;
  let voided = 0;
  for (const m of resolved) {
    const pnl = m.realizedPnlUsd ?? 0;
    realized += pnl;
    if (pnl > 0) grossWins += pnl;
    if (pnl < 0) {
      grossLosses += -pnl;
      largestLoss = Math.max(largestLoss, -pnl);
    }
    if (m.status === "resolved_win") wins += 1;
    else if (m.status === "resolved_loss") losses += 1;
    else voided += 1;
  }

  const deployed = markets.reduce((acc, m) => acc + m.costUsd, 0);
  const largestStake = markets.reduce((acc, m) => Math.max(acc, m.costUsd), 0);
  const openCost = open.reduce((acc, m) => acc + Math.max(0, m.costUsd - m.proceedsUsd), 0);
  const openIds = new Set(open.map((m) => m.marketId.toLowerCase()));
  const openMarks = marks.filter((x) => openIds.has(x.marketId.toLowerCase()));
  const markValue = openMarks.reduce((acc, x) => acc + x.valueUsd, 0);
  const unrealized = openMarks.reduce((acc, x) => acc + (x.pnlUsd ?? 0), 0);
  const drawdown = maxDrawdown(resolved.map((m) => m.realizedPnlUsd ?? 0));
  const decided = wins + losses;

  return {
    realizedPnlUsd: round2(realized),
    unrealizedPnlUsd: round2(unrealized),
    capitalDeployedUsd: round2(deployed),
    roi: deployed > 0 ? round4(realized / deployed) : null,
    wins,
    losses,
    voided,
    winRate: decided > 0 ? round4(wins / decided) : null,
    maxDrawdownUsd: drawdown.usd,
    maxDrawdownPct: deployed > 0 ? round4(drawdown.usd / deployed) : null,
    exposure: {
      openCostUsd: round2(openCost),
      markValueUsd: round2(markValue),
      openMarkets: open.length,
    },
    risk: {
      largestStakeUsd: round2(largestStake),
      largestStakeShare: deployed > 0 ? round4(largestStake / deployed) : null,
      largestLossUsd: round2(largestLoss),
      profitFactor: grossLosses > 0 ? round4(grossWins / grossLosses) : null,
      avgStakeUsd: markets.length > 0 ? round2(deployed / markets.length) : 0,
    },
  };
}
