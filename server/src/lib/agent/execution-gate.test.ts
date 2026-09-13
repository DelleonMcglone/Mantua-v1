import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SimulationDeps, TradeSimulation } from "./trade-simulation.ts";
import type { MarketTradeQuote } from "../sports/market-trade-build.ts";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { AGENT_MODES, isAgentMode, modePolicy } = await import("./agent-mode.ts");
const { ConfirmationStore, argsHash } = await import("./confirmation-store.ts");
const {
  ExecutionRefusedError,
  MONEY_TOOLS,
  authorizeExecution,
  buildTurnContext,
  isMoneyCall,
  turnContextPrompt,
  withConfirmationId,
} = await import("./execution-gate.ts");
const { simulateMarketTrade } = await import("./trade-simulation.ts");

/**
 * Phase 8 / A-026 … A-035 — the LLM proposes, the gate decides. These
 * tests are the guarantee the roadmap asks for: money never moves without
 * the user's own explicit confirmation, a server-minted id, matching
 * parameters, and (for market trades) a fresh simulation without drift.
 */

const MARKET = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

function FEE(playoffs: boolean): MarketTradeQuote["fee"] {
  return {
    feePips: 0,
    ratePips: 0,
    probabilityBps: 5000,
    playoffs,
    stale: false,
    feeRaw: "0",
    feeUsdcRaw: "0",
    breakdown: {
      minRate: 0,
      liquidityPremium: 0,
      volatilityPremium: 0,
      activityPremium: 0,
      uncertaintyPremium: 0,
      rate: 0,
      probabilityBps: 5000,
      playoffs,
      stale: false,
    },
  };
}

function quoteOf(effectivePriceBps = 5000): MarketTradeQuote {
  return {
    marketId: MARKET,
    marketAddress: "0x3333333333333333333333333333333333333333",
    yesToken: "0x3333333333333333333333333333333333333333",
    quote: {
      amountIn: "10000000",
      amountOut: "20000000",
      amountOutMinimum: "19800000",
      effectivePriceBps,
    },
    fee: FEE(false),
  };
}

function simDeps(effectivePriceBps = 5000, over: Partial<SimulationDeps> = {}): SimulationDeps {
  return {
    quote: () => Promise.resolve(quoteOf(effectivePriceBps)),
    wallet: () =>
      Promise.resolve({
        usdcBalanceRaw: 100_000_000n,
        yesBalanceRaw: 0n,
        dailyCapUsd: 100,
        spentTodayUsd: 0,
      }),
    policy: () => Promise.resolve(null),
    league: () => Promise.resolve("nfl"),
    marketImpliedBps: () => Promise.resolve(5000),
    now: () => 1_000_000,
    id: () => "sim",
    ...over,
  };
}

const TRADE_ARGS = {
  providerEventId: "401",
  outcomeIndex: 0 as const,
  direction: "buy" as const,
  amountRaw: 10_000_000n,
};

async function simulation(price = 5000): Promise<TradeSimulation> {
  return simulateMarketTrade(simDeps(price), TRADE_ARGS, 8453);
}

function newStore() {
  const clock = { t: 1_000_000 };
  return { store: new ConfirmationStore({ client: null, now: () => clock.t }), clock };
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ExecutionRefusedError) return err.code;
    throw err;
  }
  return "NONE";
}

void describe("agent mode policy", () => {
  void it("enumerates the modes and their write posture", () => {
    assert.deepEqual([...AGENT_MODES], ["disabled", "simulation", "user_testing", "autonomous"]);
    assert.equal(isAgentMode("user_testing"), true);
    assert.equal(isAgentMode("yolo"), false);
    assert.equal(modePolicy("disabled").enabled, false);
    assert.equal(modePolicy("simulation").writesAllowed, false);
    assert.equal(modePolicy("user_testing").confirmationRequired, true);
    assert.equal(modePolicy("autonomous").confirmationRequired, false);
  });
});

void describe("isMoneyCall", () => {
  void it("classifies the user's money tools; x402 paid data and reads pass", () => {
    for (const t of MONEY_TOOLS) assert.equal(isMoneyCall(t, {}), true, t);
    assert.equal(isMoneyCall("gateway", { action: "spend" }), true);
    assert.equal(isMoneyCall("gateway", { action: "balance" }), false);
    assert.equal(
      isMoneyCall("call_paid_service", { url: "https://x" }),
      false,
      "D-114: agent's own pre-capped spend",
    );
    assert.equal(isMoneyCall("get_sports_slate", {}), false);
    assert.equal(isMoneyCall("mantua_simulate_trade", {}), false);
  });

  void it("adds confirmationId to a tool schema without touching the rest", () => {
    const t = withConfirmationId({
      name: "swap",
      input_schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
    });
    assert.deepEqual(Object.keys(t.input_schema.properties), ["a", "confirmationId"]);
    assert.deepEqual(t.input_schema.required, ["a"]);
  });
});

void describe("buildTurnContext", () => {
  void it("mints only when the user's own message confirms a pending preview", async () => {
    const { store } = newStore();
    const none = await buildTurnContext(store, {
      mode: "user_testing",
      sessionId: "s",
      message: "confirm",
      autoTradeEnabled: false,
    });
    assert.equal(none.confirmation, null, "nothing pending → nothing minted");
    assert.match(turnContextPrompt(none), /No confirmation is present/);

    await store.savePreview({
      sessionId: "s",
      kind: "action",
      tool: "send",
      argsHash: argsHash("send", { to: "0xabc", amount: "1" }),
      simulation: null,
      summary: "send 1 USDC",
    });
    const hedged = await buildTurnContext(store, {
      mode: "user_testing",
      sessionId: "s",
      message: "looks good?",
      autoTradeEnabled: false,
    });
    assert.equal(hedged.confirmation, null);
    assert.equal(hedged.pendingPreview?.summary, "send 1 USDC");
    assert.match(turnContextPrompt(hedged), /NOT confirmed/);

    const yes = await buildTurnContext(store, {
      mode: "user_testing",
      sessionId: "s",
      message: "yes, confirm",
      autoTradeEnabled: false,
    });
    assert.ok(yes.confirmation);
    assert.equal(yes.pendingPreview, null);
    assert.match(
      turnContextPrompt(yes),
      new RegExp(`Confirmation id: ${yes.confirmation.confirmationId}`),
    );

    const again = await buildTurnContext(store, {
      mode: "user_testing",
      sessionId: "s",
      message: "confirm",
      autoTradeEnabled: false,
    });
    assert.equal(again.confirmation, null, "the preview was spent by the first confirmation");
  });
});

void describe("authorizeExecution — user_testing (Always Ask)", () => {
  const base = {
    mode: "user_testing" as const,
    sessionId: "s",
    message: "confirm",
    autoTradeEnabled: true,
  };

  void it("passes reads through untouched", async () => {
    const { store } = newStore();
    const ctx = { ...base, confirmation: null, pendingPreview: null };
    assert.equal(
      await authorizeExecution(store, ctx, { tool: "get_sports_slate", args: {} }),
      null,
    );
    assert.equal(
      await authorizeExecution(store, ctx, {
        tool: "call_paid_service",
        args: { url: "https://x" },
      }),
      null,
    );
  });

  void it("refuses without a confirmation id, with an invented one, and with a mismatched tool or args", async () => {
    const { store } = newStore();
    const sendArgs = { to: "0xabc", amount: "1" };
    await store.savePreview({
      sessionId: "s",
      kind: "action",
      tool: "send",
      argsHash: argsHash("send", sendArgs),
      simulation: null,
      summary: "send",
    });
    const noId = await buildTurnContext(store, { ...base, message: "send it now" });
    assert.equal(
      await refusal(authorizeExecution(store, noId, { tool: "send", args: sendArgs })),
      "CONFIRMATION_REQUIRED",
    );
    assert.equal(
      await refusal(
        authorizeExecution(store, noId, {
          tool: "send",
          args: { ...sendArgs, confirmationId: "made-up" },
        }),
      ),
      "CONFIRMATION_INVALID",
    );

    const ctx = await buildTurnContext(store, base);
    assert.ok(ctx.confirmation);
    const id = ctx.confirmation.confirmationId;
    assert.equal(
      await refusal(
        authorizeExecution(store, ctx, {
          tool: "send",
          args: { ...sendArgs, confirmationId: "other" },
        }),
      ),
      "CONFIRMATION_INVALID",
    );
    assert.equal(
      await refusal(
        authorizeExecution(store, ctx, { tool: "swap", args: { ...sendArgs, confirmationId: id } }),
      ),
      "CONFIRMATION_MISMATCH",
    );
    // The mismatch consumed the id: it is single-use whatever the outcome.
    assert.equal(
      await refusal(
        authorizeExecution(store, ctx, { tool: "send", args: { ...sendArgs, confirmationId: id } }),
      ),
      "CONFIRMATION_EXPIRED",
    );
  });

  void it("refuses when the arguments differ from the confirmed preview", async () => {
    const { store } = newStore();
    await store.savePreview({
      sessionId: "s",
      kind: "action",
      tool: "send",
      argsHash: argsHash("send", { to: "0xabc", amount: "1" }),
      simulation: null,
      summary: "send",
    });
    const ctx = await buildTurnContext(store, base);
    assert.ok(ctx.confirmation);
    const id = ctx.confirmation.confirmationId;
    assert.equal(
      await refusal(
        authorizeExecution(store, ctx, {
          tool: "send",
          args: { to: "0xabc", amount: "100", confirmationId: id },
        }),
      ),
      "CONFIRMATION_MISMATCH",
    );
  });

  void it("executes a matching action exactly once", async () => {
    const { store } = newStore();
    const args = { to: "0xabc", amount: "1" };
    await store.savePreview({
      sessionId: "s",
      kind: "action",
      tool: "send",
      argsHash: argsHash("send", args),
      simulation: null,
      summary: "send",
    });
    const ctx = await buildTurnContext(store, base);
    assert.ok(ctx.confirmation);
    const id = ctx.confirmation.confirmationId;
    const consumed = await authorizeExecution(store, ctx, {
      tool: "send",
      args: { ...args, confirmationId: id, extra: undefined },
    });
    assert.equal(consumed?.confirmationId, id);
    assert.equal(
      await refusal(
        authorizeExecution(store, ctx, { tool: "send", args: { ...args, confirmationId: id } }),
      ),
      "CONFIRMATION_EXPIRED",
    );
  });

  void it("re-simulates a market trade and refuses on material drift, executes without it", async () => {
    const { store } = newStore();
    const confirmed = await simulation(5000);
    await store.savePreview({
      sessionId: "s",
      kind: "market_trade",
      tool: "mantua_execute_trade",
      argsHash: "",
      simulation: confirmed,
      summary: "buy",
    });
    const ctx = await buildTurnContext(store, base);
    assert.ok(ctx.confirmation);
    const id = ctx.confirmation.confirmationId;
    const call = {
      tool: "mantua_execute_trade",
      args: { providerEventId: "401", outcomeIndex: 0, amount: "10", confirmationId: id },
    };
    assert.equal(
      await refusal(authorizeExecution(store, ctx, call, () => simulation(5200))),
      "SIMULATION_DRIFT",
    );

    const ctx2 = await (async () => {
      await store.savePreview({
        sessionId: "s",
        kind: "market_trade",
        tool: "mantua_execute_trade",
        argsHash: "",
        simulation: confirmed,
        summary: "buy",
      });
      return buildTurnContext(store, base);
    })();
    assert.ok(ctx2.confirmation);
    const ok = await authorizeExecution(
      store,
      ctx2,
      { ...call, args: { ...call.args, confirmationId: ctx2.confirmation.confirmationId } },
      () => simulation(5050),
    );
    assert.equal(ok?.preview.kind, "market_trade");
  });

  void it("refuses a market execution whose confirmation lacks a simulation", async () => {
    const { store } = newStore();
    await store.savePreview({
      sessionId: "s",
      kind: "market_trade",
      tool: "mantua_execute_trade",
      argsHash: "",
      simulation: null,
      summary: "buy",
    });
    const ctx = await buildTurnContext(store, base);
    assert.ok(ctx.confirmation);
    const code = await refusal(
      authorizeExecution(
        store,
        ctx,
        { tool: "mantua_execute_trade", args: { confirmationId: ctx.confirmation.confirmationId } },
        () => simulation(),
      ),
    );
    assert.equal(code, "CONFIRMATION_MISMATCH");
  });
});

void describe("authorizeExecution — other modes", () => {
  void it("simulation mode never executes, even with a valid confirmation", async () => {
    const { store } = newStore();
    await store.savePreview({
      sessionId: "s",
      kind: "action",
      tool: "send",
      argsHash: argsHash("send", { a: 1 }),
      simulation: null,
      summary: "send",
    });
    const ctx = await buildTurnContext(store, {
      mode: "simulation",
      sessionId: "s",
      message: "confirm",
      autoTradeEnabled: true,
    });
    assert.ok(ctx.confirmation);
    assert.equal(
      await refusal(
        authorizeExecution(store, ctx, {
          tool: "send",
          args: { a: 1, confirmationId: ctx.confirmation.confirmationId },
        }),
      ),
      "SIMULATION_MODE",
    );
  });

  void it("autonomous mode still requires the user's policy flag, and a fresh executable simulation", async () => {
    const { store } = newStore();
    const off = {
      mode: "autonomous" as const,
      sessionId: "s",
      message: "buy it",
      confirmation: null,
      pendingPreview: null,
      autoTradeEnabled: false,
    };
    assert.equal(
      await refusal(authorizeExecution(store, off, { tool: "send", args: {} })),
      "CONFIRMATION_REQUIRED",
    );

    const on = { ...off, autoTradeEnabled: true };
    assert.equal(await authorizeExecution(store, on, { tool: "send", args: {} }), null);
    const blocked = () =>
      simulateMarketTrade(
        simDeps(5000, {
          wallet: () =>
            Promise.resolve({
              usdcBalanceRaw: 0n,
              yesBalanceRaw: 0n,
              dailyCapUsd: 100,
              spentTodayUsd: 0,
            }),
        }),
        TRADE_ARGS,
        8453,
      );
    assert.equal(
      await refusal(
        authorizeExecution(store, on, { tool: "mantua_execute_trade", args: {} }, blocked),
      ),
      "NOT_EXECUTABLE",
    );
    assert.equal(
      await authorizeExecution(store, on, { tool: "mantua_execute_trade", args: {} }, () =>
        simulation(),
      ),
      null,
    );
  });
});
