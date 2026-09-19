import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeLedgerMetrics, maxDrawdown, type MetricMarket } from "./ledger-metrics.ts";

/**
 * Task 070 / AE-011 — realised and unrealised P&L, ROI, win/loss,
 * drawdown, exposure and the risk block, as pure functions.
 */

const market = (
  marketId: string,
  status: MetricMarket["status"],
  costUsd: number,
  proceedsUsd: number,
  realizedPnlUsd: number | null,
  resolvedAt: string | null,
): MetricMarket => ({ marketId, status, costUsd, proceedsUsd, realizedPnlUsd, resolvedAt });

const MARKETS: MetricMarket[] = [
  market("0xw1", "resolved_win", 10, 0, 6, "2026-09-10T00:00:00.000Z"),
  market("0xl1", "resolved_loss", 5, 1.5, -3.5, "2026-09-11T00:00:00.000Z"),
  market("0xl2", "resolved_loss", 8, 0, -8, "2026-09-12T00:00:00.000Z"),
  market("0xw2", "resolved_win", 4, 0, 2, "2026-09-13T00:00:00.000Z"),
  market("0xv", "voided", 3, 0, 0, "2026-09-13T01:00:00.000Z"),
  market("0xo", "open", 6, 0, null, null),
];
const MARKS = [{ marketId: "0xo", valueUsd: 7.2, pnlUsd: 1.2 }];

void describe("maxDrawdown", () => {
  void it("measures the deepest peak-to-trough fall of the cumulative series", () => {
    // Cumulative: 6 → 2.5 → −5.5 → −3.5 → −3.5. Peak 6, trough −5.5.
    assert.deepEqual(maxDrawdown([6, -3.5, -8, 2, 0]), { usd: 11.5, peakUsd: 6 });
    assert.deepEqual(maxDrawdown([]), { usd: 0, peakUsd: 0 });
    assert.deepEqual(maxDrawdown([1, 2, 3]), { usd: 0, peakUsd: 6 });
  });

  void it("starts equity at zero, so the first loss is already a fall from the peak", () => {
    assert.deepEqual(maxDrawdown([-2, -3]), { usd: 5, peakUsd: 0 });
    assert.deepEqual(maxDrawdown([10, -4]), { usd: 4, peakUsd: 10 });
  });
});

void describe("computeLedgerMetrics", () => {
  const m = computeLedgerMetrics(MARKETS, MARKS);

  void it("separates realised from unrealised and reports ROI on capital deployed", () => {
    assert.equal(m.realizedPnlUsd, -3.5);
    assert.equal(m.unrealizedPnlUsd, 1.2);
    assert.equal(m.capitalDeployedUsd, 36); // every buy: 10+5+8+4+3+6
    assert.equal(m.roi, Number((-3.5 / 36).toFixed(4)));
    assert.deepEqual(
      { wins: m.wins, losses: m.losses, voided: m.voided, winRate: m.winRate },
      { wins: 2, losses: 2, voided: 1, winRate: 0.5 },
    );
  });

  void it("orders drawdown by resolution time, ignoring open and voided markets' nulls", () => {
    // Series by resolvedAt: 6, −3.5, −8, 2, 0(void) → cumulative peak 6, trough −5.5.
    // The share is of capital deployed, the only denominator a P&L series has.
    assert.equal(m.maxDrawdownUsd, 11.5);
    assert.equal(m.maxDrawdownPct, Number((11.5 / 36).toFixed(4)));
  });

  void it("reports exposure as open cost and mark, and the risk block", () => {
    assert.deepEqual(m.exposure, { openCostUsd: 6, markValueUsd: 7.2, openMarkets: 1 });
    assert.equal(m.risk.largestStakeUsd, 10);
    assert.equal(m.risk.largestStakeShare, Number((10 / 36).toFixed(4)));
    assert.equal(m.risk.largestLossUsd, 8);
    assert.equal(m.risk.profitFactor, Number((8 / 11.5).toFixed(4)));
    assert.equal(m.risk.avgStakeUsd, 6);
  });

  void it("is defined on an empty ledger", () => {
    const empty = computeLedgerMetrics([], []);
    assert.equal(empty.roi, null);
    assert.equal(empty.winRate, null);
    assert.equal(empty.risk.profitFactor, null);
    assert.equal(empty.risk.largestStakeShare, null);
    assert.equal(empty.maxDrawdownUsd, 0);
  });
});
