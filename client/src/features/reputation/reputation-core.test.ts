import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  agentHandleFromPath,
  agentPagePath,
  marketRows,
  metricRows,
  modeRows,
  riskRows,
  shortDigest,
  type PublicAgent,
} from "./reputation-core.ts";

/** Task 070 / AE-012 — every figure on the public page comes from a pure, pinned mapping. */

const agent: PublicAgent = {
  handle: "sage",
  displayName: "Sideline Sage",
  bio: "",
  walletAddress: "0xabc",
  platform: "x",
  ledger: {
    digest: "0123456789abcdef".repeat(4),
    trades: [],
    markets: [
      {
        marketId: "0xw",
        status: "resolved_win",
        modes: ["user_confirmed"],
        costUsd: 10,
        proceedsUsd: 0,
        payoutUsd: 16,
        realizedPnlUsd: 6,
        trades: 1,
        resolvedAt: "2026-09-10T00:00:00.000Z",
        lastTradeAt: "2026-09-09T00:00:00.000Z",
      },
      {
        marketId: "0xl",
        status: "resolved_loss",
        modes: ["autonomous"],
        costUsd: 5,
        proceedsUsd: 1.5,
        payoutUsd: 0,
        realizedPnlUsd: -3.5,
        trades: 2,
        resolvedAt: "2026-09-11T00:00:00.000Z",
        lastTradeAt: "2026-09-10T00:00:00.000Z",
      },
      {
        marketId: "0xo",
        status: "open",
        modes: ["unattributed"],
        costUsd: 6,
        proceedsUsd: 0,
        payoutUsd: 0,
        realizedPnlUsd: null,
        trades: 1,
        resolvedAt: null,
        lastTradeAt: "2026-09-12T00:00:00.000Z",
      },
    ],
    byMode: {
      simulated: { trades: 0, stakedUsd: 0, realizedPnlUsd: 0, markets: 0 },
      user_confirmed: { trades: 1, stakedUsd: 10, realizedPnlUsd: 6, markets: 1 },
      autonomous: { trades: 2, stakedUsd: 5, realizedPnlUsd: -3.5, markets: 1 },
      unattributed: { trades: 1, stakedUsd: 6, realizedPnlUsd: 0, markets: 1 },
    },
    mixedMarkets: 0,
    simulated: { count: 3, executable: 2, notionalUsd: 12, latestAt: null },
    totals: { wins: 1, losses: 1, voided: 0, trades: 4, openMarkets: 1 },
  },
  metrics: {
    realizedPnlUsd: 2.5,
    unrealizedPnlUsd: -0.4,
    capitalDeployedUsd: 21,
    roi: 0.119,
    winRate: 0.5,
    maxDrawdownUsd: 3.5,
    maxDrawdownPct: 0.1667,
    exposure: { openCostUsd: 6, markValueUsd: 5.6, openMarkets: 1 },
    risk: {
      largestStakeUsd: 10,
      largestStakeShare: 0.4762,
      largestLossUsd: 3.5,
      profitFactor: 1.71,
      avgStakeUsd: 7,
    },
  },
  marksAvailable: true,
  computedAt: "2026-09-18T15:00:00.000Z",
  posts: [],
};

void describe("reputation-core", () => {
  void it("parses and builds the public URL", () => {
    assert.equal(agentHandleFromPath("/agents/sage"), "sage");
    assert.equal(agentHandleFromPath("/agents/Sage/"), "sage");
    assert.equal(agentHandleFromPath("/agents/no spaces"), null);
    assert.equal(agentHandleFromPath("/docs"), null);
    assert.equal(agentPagePath("sage"), "/agents/sage");
  });

  void it("renders the metric tiles with sign and tone", () => {
    const rows = metricRows(agent);
    assert.deepEqual(rows[0], { label: "Realised P&L", value: "+$2.50", tone: "up" });
    assert.deepEqual(rows[1], { label: "Unrealised P&L", value: "−$0.40", tone: "down" });
    assert.equal(rows[2].value, "11.9%");
    assert.equal(rows[3].value, "1–1");
    assert.equal(rows[5].value, "$3.50 (16.7%)");
    const noMarks = metricRows({ ...agent, marksAvailable: false });
    assert.equal(noMarks[1].value, "unavailable");
  });

  void it("keeps simulations out of the P&L column and labels each mode", () => {
    const rows = modeRows(agent);
    assert.equal(rows[0].mode, "simulated");
    assert.equal(rows[0].trades, 3);
    assert.equal(rows[0].realized, "no capital at risk");
    assert.equal(rows[0].note, "2 would have executed");
    assert.equal(rows[2].label, "Autonomous");
    assert.equal(rows[2].realized, "−$3.50");
  });

  void it("lists every market including the loss, newest first, with its result", () => {
    const rows = marketRows(agent);
    assert.deepEqual(
      rows.map((r) => r.marketId),
      ["0xo", "0xl", "0xw"],
    );
    assert.equal(rows[1].statusLabel, "Loss");
    assert.equal(rows[1].result, "−$3.50");
    assert.equal(rows[0].result, "$6.00 at risk");
  });

  void it("renders the risk block and a short digest", () => {
    assert.equal(riskRows(agent)[0].value, "$10.00 (47.6% of deployed)");
    assert.equal(riskRows(agent)[2].value, "1.71");
    assert.equal(shortDigest(agent.ledger.digest), "01234567…abcdef");
  });
});
