import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFinalizationPlan, type FinalizationInput } from "./finalize.ts";

const AGENT = `0x${"ab".repeat(20)}`;
const TX = `0x${"cd".repeat(32)}`;

function tradePayload(overrides: Record<string, unknown> = {}) {
  // Mirrors what agent-chat persists (plus the keys market-agent-trade adds).
  return {
    agentAddress: AGENT,
    providerEventId: "401772938",
    outcomeIndex: 0,
    direction: "buy",
    amountRaw: "25000000",
    expectedOutRaw: "41000000",
    marketId: `0x${"11".repeat(32)}`,
    chainId: 5042,
    confirmationId: "conf-1",
    ...overrides,
  };
}

function input(overrides: Partial<FinalizationInput> = {}): FinalizationInput {
  return {
    kind: "agent_trade",
    status: "pending",
    state: "CONFIRMED",
    circleTxId: "circle-tx-9",
    txHash: TX,
    errorReason: null,
    payload: tradePayload(),
    source: "webhook",
    userId: "user-1",
    ...overrides,
  };
}

describe("buildFinalizationPlan — agent_trade", () => {
  it("a confirmed buy records the spend, the fill and a success audit", () => {
    const plan = buildFinalizationPlan(input());
    assert.ok(plan);
    assert.equal(plan.outcome, "confirmed");
    assert.deepEqual(
      plan.effects.map((e) => e.type),
      ["record_spend", "agent_trade_fill", "audit"],
    );
    const spend = plan.effects[0] as { walletAddress: string; usdValue: number };
    assert.equal(spend.walletAddress, AGENT);
    assert.equal(spend.usdValue, 25);
    const fill = plan.effects[1] as { txHash: string; userId: string | null };
    assert.equal(fill.txHash, TX);
    assert.equal(fill.userId, "user-1");
    const audit = plan.effects[2] as { entry: { action: string; outcome: string } };
    assert.equal(audit.entry.action, "agent_market_trade");
    assert.equal(audit.entry.outcome, "success");
  });

  it("a confirmed sell records the fill and the audit but no spend", () => {
    const plan = buildFinalizationPlan(
      input({ payload: tradePayload({ direction: "sell", expectedOutRaw: "19500000" }) }),
    );
    assert.ok(plan);
    assert.deepEqual(
      plan.effects.map((e) => e.type),
      ["agent_trade_fill", "audit"],
    );
  });

  it("a reverted trade spends nothing and fills nothing — audit failure only", () => {
    const plan = buildFinalizationPlan(
      input({ state: "FAILED", errorReason: "execution reverted", txHash: null }),
    );
    assert.ok(plan);
    assert.equal(plan.outcome, "failed");
    assert.deepEqual(
      plan.effects.map((e) => e.type),
      ["audit"],
    );
    const audit = plan.effects[0] as { entry: { outcome: string; reason?: string } };
    assert.equal(audit.entry.outcome, "failure");
    assert.match(audit.entry.reason ?? "", /FAILED: execution reverted/);
  });

  it("a confirmation without a hash skips the fill (nothing to key it by)", () => {
    const plan = buildFinalizationPlan(input({ txHash: null }));
    assert.ok(plan);
    assert.deepEqual(
      plan.effects.map((e) => e.type),
      ["record_spend", "audit"],
    );
  });

  it("refuses a malformed payload and a non-terminal state", () => {
    assert.equal(buildFinalizationPlan(input({ payload: { direction: "buy" } })), null);
    assert.equal(buildFinalizationPlan(input({ state: "SENT" })), null);
  });
});
