import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TransactionState } from "@circle-fin/developer-controlled-wallets";
import { buildFinalizationPlan, type FinalizationInput } from "./finalize.ts";

const PENDING = "pending";

function sendPayload(overrides: Record<string, unknown> = {}) {
  return {
    to: "0x1234567890abcdef1234567890abcdef12345678",
    symbol: "USDC",
    amountDecimal: "5",
    amountAtomic: "5000000",
    usdValue: 5,
    network: "base",
    agentAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdef12",
    ...overrides,
  };
}

function input(overrides: Partial<FinalizationInput>): FinalizationInput {
  return {
    kind: "agent_send",
    status: PENDING,
    state: "CONFIRMED",
    circleTxId: "circle-tx-1",
    txHash: `0x${"cd".repeat(32)}`,
    errorReason: null,
    payload: sendPayload(),
    source: "webhook",
    ...overrides,
  };
}

describe("buildFinalizationPlan — agent_send", () => {
  it("confirms with spend recording, audit success and portfolio history", () => {
    const plan = buildFinalizationPlan(input({}));
    assert.ok(plan);
    assert.equal(plan.outcome, "confirmed");
    const types = plan.effects.map((e) => e.type);
    assert.deepEqual(types, ["record_spend", "audit", "portfolio_tx"]);
  });

  it("does not double-record spend when the provisional spend was already written", () => {
    const plan = buildFinalizationPlan(
      input({ payload: sendPayload({ provisionalSpendingUsd: 5 }) }),
    );
    assert.ok(plan);
    const types = plan.effects.map((e) => e.type);
    assert.equal(types.includes("record_spend"), false);
    assert.equal(types.includes("portfolio_tx"), true);
  });

  it("reverses provisional spend on failure and records the audit failure", () => {
    const plan = buildFinalizationPlan(
      input({
        state: "FAILED",
        errorReason: "execution reverted",
        payload: sendPayload({ provisionalSpendingUsd: 5 }),
      }),
    );
    assert.ok(plan);
    assert.equal(plan.outcome, "failed");
    const types = plan.effects.map((e) => e.type);
    assert.deepEqual(types, ["reverse_spend", "audit"]);
    assert.equal(types.includes("portfolio_tx"), false);
    assert.equal(types.includes("record_spend"), false);
  });

  it("records only the audit failure when nothing was provisionally spent", () => {
    const plan = buildFinalizationPlan(
      input({ state: "FAILED", errorReason: "execution reverted" }),
    );
    assert.ok(plan);
    assert.equal(plan.outcome, "failed");
    const types = plan.effects.map((e) => e.type);
    assert.deepEqual(types, ["audit"]);
  });
});

describe("buildFinalizationPlan — strategy_close", () => {
  function closePayload(overrides: Record<string, unknown> = {}) {
    // Mirrors the payload market-agent-trade persists for a close.
    return {
      strategyId: "s1",
      action: "strategy_close",
      marketId: `0x${"11".repeat(32)}`,
      soldRaw: "25000000",
      usdcOutRaw: "25000000",
      ...overrides,
    };
  }

  it("closes the position only on a confirmed receipt", () => {
    const plan = buildFinalizationPlan(input({ kind: "strategy_close", payload: closePayload() }));
    assert.ok(plan);
    assert.equal(plan.outcome, "confirmed");
    const types = plan.effects.map((e) => e.type);
    assert.deepEqual(types, ["close_position"]);
  });

  it("never closes a position for a reverted trade", () => {
    const plan = buildFinalizationPlan(
      input({
        kind: "strategy_close",
        state: "FAILED",
        errorReason: "execution reverted",
        payload: closePayload(),
      }),
    );
    assert.ok(plan);
    assert.equal(plan.outcome, "failed");
    const types = plan.effects.map((e) => e.type);
    assert.equal(types.includes("close_position"), false);
    assert.deepEqual(types, ["audit_strategy"]);
    const audit = plan.effects.find((e) => e.type === "audit_strategy") as {
      outcome: string;
    };
    assert.equal(audit.outcome, "failure");
  });
});

describe("buildFinalizationPlan — guards", () => {
  it("ignores non-terminal states", () => {
    for (const state of ["SENT", "STUCK"] as TransactionState[]) {
      assert.equal(buildFinalizationPlan(input({ state })), null);
    }
  });

  it("ignores rows that are not pending", () => {
    assert.equal(buildFinalizationPlan(input({ status: "confirmed" })), null);
  });

  it("ignores unknown kinds and malformed payloads", () => {
    assert.equal(buildFinalizationPlan(input({ kind: "unknown_kind" })), null);
    assert.equal(buildFinalizationPlan(input({ payload: { not: "a send payload" } })), null);
  });
});
