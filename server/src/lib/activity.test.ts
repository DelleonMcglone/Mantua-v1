import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const {
  ACTIVITY_KINDS,
  ACTIVITY_STATUSES,
  canTransitionActivity,
  categoryOf,
  isActivityKind,
  kindForAction,
  summarizeActivity,
} = await import("./activity.ts");

/** Phase 9 / PF-015 … PF-017, PF-020 — the activity model's pure rules. */

void describe("activity kinds and categories", () => {
  void it("every kind has a category, and unknown strings are rejected", () => {
    for (const k of ACTIVITY_KINDS) assert.ok(categoryOf(k), k);
    assert.equal(categoryOf("market_buy"), "trade");
    assert.equal(categoryOf("hedge"), "trade");
    assert.equal(categoryOf("liquidity_add"), "liquidity");
    assert.equal(categoryOf("deposit"), "transfer");
    assert.equal(categoryOf("agent_research"), "agent");
    assert.equal(categoryOf("settlement"), "settlement");
    assert.equal(isActivityKind("market_buy"), true);
    assert.equal(isActivityKind("agent_action"), false, "the 0009 placeholder vocab is gone");
  });

  void it("maps the audit / execution vocabulary onto kinds, reading direction from params", () => {
    assert.equal(kindForAction("agent_send"), "send");
    assert.equal(kindForAction("send"), "send");
    assert.equal(kindForAction("strategy_execute"), "hedge");
    assert.equal(kindForAction("agent_market_trade", { direction: "sell" }), "market_sell");
    assert.equal(kindForAction("agent_market_trade", { direction: "buy" }), "market_buy");
    assert.equal(kindForAction("agent_gateway", { action: "spend" }), "gateway_spend");
    assert.equal(kindForAction("agent_gateway", { action: "deposit_base" }), "gateway_deposit");
    assert.equal(kindForAction("fiat_withdraw"), "withdraw");
    assert.equal(kindForAction("fee_admin_update"), null);
  });
});

void describe("PF-017 status machine", () => {
  void it("pending moves exactly once, to completed or failed; terminal states never move", () => {
    assert.equal(canTransitionActivity("pending", "completed"), true);
    assert.equal(canTransitionActivity("pending", "failed"), true);
    for (const from of ACTIVITY_STATUSES) {
      assert.equal(canTransitionActivity(from, "pending"), false, `${from} → pending`);
    }
    assert.equal(canTransitionActivity("completed", "failed"), false);
    assert.equal(canTransitionActivity("failed", "completed"), false);
  });
});

void describe("summarizeActivity", () => {
  void it("writes the one-line summary from the fields, naming the agent when it acted", () => {
    assert.equal(
      summarizeActivity({
        kind: "market_buy",
        actor: "user",
        amountRaw: "16000000",
        asset: "YES",
        valueUsd: 10,
      }),
      "bought 16.00 YES for $10.00",
    );
    assert.equal(
      summarizeActivity({
        kind: "market_sell",
        actor: "agent",
        amountRaw: "4000000",
        valueUsd: 2.5,
      }),
      "Agent sold 4.00 YES for $2.50",
    );
    assert.equal(
      summarizeActivity({ kind: "hedge", actor: "agent", asset: "stop", valueUsd: 3 }),
      "Agent hedged stop ($3.00)",
    );
    assert.equal(
      summarizeActivity({ kind: "deposit", actor: "user", valueUsd: 100 }),
      "Deposited $100.00",
    );
    assert.equal(
      summarizeActivity({ kind: "agent_research", actor: "agent", asset: "Falcons vs Saints" }),
      "Agent analyzed Falcons vs Saints",
    );
    assert.equal(
      summarizeActivity({
        kind: "settlement",
        actor: "system",
        asset: "Falcons YES",
        valueUsd: 16,
      }),
      "Market settled — Falcons YES ($16.00)",
    );
  });
});
