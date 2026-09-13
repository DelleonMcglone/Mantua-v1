import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePerformance, type FillRow } from "./performance.ts";

/** Phase 8 / A-016 — realized P&L and win rate from fills + resolutions. */

const t = (h: number): Date => new Date(Date.UTC(2026, 8, 12, h));
const fill = (
  marketId: string,
  direction: "buy" | "sell",
  tokens: number,
  usdc: number,
  h: number,
): FillRow => ({
  marketId,
  direction,
  tokensRaw: String(Math.round(tokens * 1e6)),
  usdcRaw: String(Math.round(usdc * 1e6)),
  createdAt: t(h),
});

void describe("computePerformance", () => {
  void it("scores a win, a loss, a void and an open market, with totals", () => {
    const perf = computePerformance(
      "0xabc",
      [
        // WIN: buy 16 YES for 10, market resolves to this side → payout 16.
        fill("0xwin", "buy", 16, 10, 1),
        // LOSS: buy 8 YES for 5, sell 2 for 1.5, other side wins → payout 0.
        fill("0xloss", "buy", 8, 5, 2),
        fill("0xloss", "sell", 2, 1.5, 3),
        // VOID: buy 4 YES for 3, voided → refund 4 at par.
        fill("0xvoid", "buy", 4, 3, 4),
        // OPEN: buy 10 for 6, sell 5 for 3.5 — still open.
        fill("0xopen", "buy", 10, 6, 5),
        fill("0xopen", "sell", 5, 3.5, 6),
      ],
      [
        { marketId: "0xwin", outcomeIndex: 0, state: "RESOLVED", resolvedAt: t(10) },
        { marketId: "0xloss", outcomeIndex: 1, state: "RESOLVED", resolvedAt: t(10) },
        { marketId: "0xvoid", outcomeIndex: 0, state: "VOID", resolvedAt: t(10) },
        { marketId: "0xopen", outcomeIndex: 0, state: "OPEN", resolvedAt: null },
      ],
      [
        { marketId: "0xwin", winningOutcomeIndex: 0, method: "auto" },
        { marketId: "0xloss", winningOutcomeIndex: 0, method: "auto" },
        { marketId: "0xvoid", winningOutcomeIndex: null, method: "void" },
      ],
    );
    const by = Object.fromEntries(perf.markets.map((m) => [m.marketId, m]));
    assert.equal(by["0xwin"].status, "resolved_win");
    assert.equal(by["0xwin"].realizedPnlUsd, 6);
    assert.equal(by["0xloss"].status, "resolved_loss");
    assert.equal(by["0xloss"].realizedPnlUsd, -3.5);
    assert.equal(by["0xvoid"].status, "voided");
    assert.equal(by["0xvoid"].realizedPnlUsd, 1);
    assert.equal(by["0xopen"].status, "open");
    assert.equal(by["0xopen"].realizedPnlUsd, null);
    assert.equal(by["0xopen"].tokensHeld, 5);
    assert.deepEqual(perf.totals, {
      resolvedMarkets: 3,
      wins: 1,
      losses: 1,
      voided: 1,
      winRate: 0.5,
      realizedPnlUsd: 3.5,
      openCostUsd: 2.5,
      openMarkets: 1,
      trades: 6,
      returnOnResolvedCost: Number((3.5 / 18).toFixed(4)),
      bySource: { agent_chat: 0, hedge_strategy: 0, user: 6 },
    });
    // Newest activity first.
    assert.equal(perf.markets[0].marketId, "0xopen");
  });

  void it("attributes fills to the chat agent, the hedge engine, or the user by audit action", () => {
    const withTx = (f: FillRow, txHash: string): FillRow => ({ ...f, txHash });
    const perf = computePerformance(
      "0xabc",
      [
        withTx(fill("0xm", "buy", 5, 3, 1), "0xAAA"),
        withTx(fill("0xm", "sell", 2, 1.5, 2), "0xbbb"),
        withTx(fill("0xn", "buy", 1, 0.5, 3), "0xccc"),
      ],
      [],
      [],
      new Map([
        ["0xaaa", "agent_market_trade"],
        ["0xbbb", "strategy_execute"],
      ]),
    );
    const by = Object.fromEntries(perf.markets.map((m) => [m.marketId, m]));
    assert.deepEqual([...by["0xm"].attribution].sort(), ["agent_chat", "hedge_strategy"]);
    assert.deepEqual(by["0xn"].attribution, ["user"]);
    assert.deepEqual(perf.totals.bySource, { agent_chat: 1, hedge_strategy: 1, user: 1 });
  });

  void it("is empty and null-rated before any trade", () => {
    const perf = computePerformance("0xabc", [], [], []);
    assert.deepEqual(perf.markets, []);
    assert.equal(perf.totals.winRate, null);
    assert.equal(perf.totals.returnOnResolvedCost, null);
  });

  void it("uses the latest resolution row and never lets held tokens go negative", () => {
    const perf = computePerformance(
      "0xabc",
      [fill("0xm", "buy", 5, 3, 1), fill("0xm", "sell", 9, 6, 2)],
      [{ marketId: "0xm", outcomeIndex: 1, state: "RESOLVED", resolvedAt: t(5) }],
      [
        { marketId: "0xm", winningOutcomeIndex: 1, method: "manual" },
        { marketId: "0xm", winningOutcomeIndex: 0, method: "auto" },
      ],
    );
    const m = perf.markets[0];
    assert.equal(m.tokensHeld, 0);
    assert.equal(
      m.status,
      "resolved_win",
      "latest (first) row says this side won; realized 6 − 3 > 0",
    );
    assert.equal(m.payoutUsd, 0);
    assert.equal(m.realizedPnlUsd, 3);
  });
});
