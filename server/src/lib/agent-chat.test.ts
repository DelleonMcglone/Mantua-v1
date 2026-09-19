import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

/**
 * 030 — audit rows for chat-driven MUTATING tool calls.
 *
 * The same swap via `routes/agent-swap.ts` writes a `mantua_audit_log` row;
 * the chat tool executor previously wrote none. `auditChatToolCall` is the
 * seam the chat loop defers after EVERY tool call — these tests prove:
 *
 *  - a mutating tool call writes exactly one row with the route-consistent
 *    action name, success outcome, wallet address, chain id, and the tool
 *    args in params;
 *  - a thrown tool error writes a failure row carrying the error as reason;
 *  - read-only tools (and the read-only sub-actions of the mixed tools)
 *    write NO row;
 *  - an unattested cap raise (structured refusal, no throw) is recorded as
 *    rejected_other, not success;
 *  - oversized args are capped, not stored unbounded.
 *
 * Style: no module mocks (the repo's seam-free approach) — the drizzle `db`
 * facade's `insert` entry point is stubbed with a fake that records the rows
 * `logAudit` writes, exactly like the x402-buyer audit tests.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { auditActionForToolCall, auditChatToolCall } = await import("./agent-chat.ts");
const { db } = await import("../db/client.ts");

const WALLET = "0xAbCd000000000000000000000000000000000001";
const CHAIN_ID = 8453 as const;

interface InsertedRow {
  walletAddress: string | null;
  action: string;
  outcome: string;
  params: Record<string, unknown>;
  txHash: string | null;
  chainId: number;
  reason: string | null;
}

const inserted: InsertedRow[] = [];
const realInsert = db.insert.bind(db);
(db as { insert: unknown }).insert = () => ({
  values: (row: InsertedRow) => {
    inserted.push(row);
    return Promise.resolve();
  },
});
after(() => {
  (db as { insert: unknown }).insert = realInsert;
});

beforeEach(() => {
  inserted.length = 0;
});

function call(
  tool: string,
  args: Record<string, unknown>,
  rest: { ok: boolean; data?: unknown; error?: string } = { ok: true },
): Promise<void> {
  return auditChatToolCall({ walletAddress: WALLET, chainId: CHAIN_ID, tool, args, ...rest });
}

void describe("agent-chat audit — action mapping", () => {
  void it("maps every mutating tool to its route/loop-consistent action", () => {
    assert.equal(auditActionForToolCall("swap", {}), "agent_swap");
    assert.equal(auditActionForToolCall("send", {}), "agent_send");
    assert.equal(auditActionForToolCall("trade_market", {}), "agent_market_trade");
    assert.equal(auditActionForToolCall("bridge", {}), "agent_bridge");
    assert.equal(auditActionForToolCall("add_liquidity", {}), "agent_add_liquidity");
    assert.equal(auditActionForToolCall("remove_liquidity", {}), "agent_remove_liquidity");
    assert.equal(auditActionForToolCall("create_pool", {}), "create_pool");
    assert.equal(auditActionForToolCall("create_job", {}), "agent_commerce");
    assert.equal(auditActionForToolCall("fund_job", {}), "agent_commerce");
    assert.equal(auditActionForToolCall("settle_job", {}), "agent_commerce");
    for (const action of ["deposit", "deposit_base", "spend"]) {
      assert.equal(auditActionForToolCall("gateway", { action }), "agent_gateway");
    }
    assert.equal(
      auditActionForToolCall("manage_wallet", { action: "set_cap" }),
      "agent_wallet_cap_update",
    );
  });

  void it("maps read-only tools and sub-actions to null", () => {
    for (const tool of [
      "get_portfolio",
      "get_swap_quote",
      "get_signals",
      "get_market_data",
      "get_fx_quote",
      "get_positions",
      "get_user_wallet",
      "get_sports_slate",
      "market_research",
      "protocol_lookup",
      "inspect_address",
      "inspect_token",
      "inspect_transaction",
      "inspect_hook_contract",
      "get_job_status",
      "search_paid_services",
    ]) {
      assert.equal(auditActionForToolCall(tool, {}), null, tool);
    }
    assert.equal(auditActionForToolCall("gateway", { action: "balance" }), null);
    assert.equal(auditActionForToolCall("manage_wallet", { action: "info" }), null);
  });
});

void describe("agent-chat audit — auditChatToolCall", () => {
  void it("writes one success row for a mutating tool call", async () => {
    const args = { tokenIn: "USDC", tokenOut: "EURC", amountIn: "25" };
    await call("swap", args, { ok: true, data: { txHash: "0x" + "a".repeat(64) } });
    assert.equal(inserted.length, 1);
    const row = inserted[0];
    assert.equal(row.action, "agent_swap");
    assert.equal(row.outcome, "success");
    assert.equal(row.walletAddress, WALLET.toLowerCase());
    assert.equal(row.chainId, CHAIN_ID);
    assert.equal(row.txHash, "0x" + "a".repeat(64));
    assert.equal(row.reason, null);
    assert.deepEqual(row.params, { tool: "swap", args });
  });

  void it("records the agent mode in the params when the loop supplies it (task 070, AE-013)", async () => {
    const args = { providerEventId: "e1", outcomeIndex: 0, amount: "5", confirmationId: "c1" };
    await auditChatToolCall({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      tool: "mantua_execute_trade",
      args,
      ok: true,
      data: { txHash: "0x" + "b".repeat(64) },
      mode: "user_testing",
    });
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].action, "agent_market_trade");
    assert.deepEqual(inserted[0].params, {
      tool: "mantua_execute_trade",
      args,
      mode: "user_testing",
    });
  });

  void it("writes a failure row with the error as reason when the tool throws", async () => {
    await call(
      "send",
      { to: "0x0000000000000000000000000000000000000002", token: "USDC", amount: "5" },
      { ok: false, error: "Insufficient agent balance: needs 5 USDC, has 1 USDC." },
    );
    assert.equal(inserted.length, 1);
    const row = inserted[0];
    assert.equal(row.action, "agent_send");
    assert.equal(row.outcome, "failure");
    assert.equal(row.reason, "Insufficient agent balance: needs 5 USDC, has 1 USDC.");
    assert.equal(row.txHash, null);
  });

  void it("writes NO row for read-only tool calls", async () => {
    await call("get_portfolio", {});
    await call("get_swap_quote", { tokenIn: "USDC", tokenOut: "EURC", amountIn: "1" });
    await call("get_market_data", { topic: "market-summary" });
    await call("gateway", { action: "balance" });
    await call("manage_wallet", { action: "info" });
    assert.equal(inserted.length, 0);
  });

  void it("audits a gateway spend as agent_gateway", async () => {
    const args = { action: "spend", amount: "10", destinationChain: "arbitrum" };
    await call("gateway", args, { ok: true, data: { status: "settled" } });
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].action, "agent_gateway");
    assert.equal(inserted[0].outcome, "success");
    assert.deepEqual(inserted[0].params, { tool: "gateway", args });
  });

  void it("audits trade_market as agent_market_trade", async () => {
    await call(
      "trade_market",
      { providerEventId: "401547", outcomeIndex: 1, direction: "buy", amount: "3" },
      { ok: true, data: { txHash: "0x" + "b".repeat(64), marketId: "0x1" } },
    );
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].action, "agent_market_trade");
    assert.equal(inserted[0].outcome, "success");
  });

  void it("records an unattested cap raise (structured refusal) as rejected_other", async () => {
    await call(
      "manage_wallet",
      { action: "set_cap", dailyCapUsd: 5000 },
      {
        ok: true,
        data: { status: "cap_raise_rejected", currentDailyCapUsd: 100, requestedDailyCapUsd: 5000 },
      },
    );
    assert.equal(inserted.length, 1);
    const row = inserted[0];
    assert.equal(row.action, "agent_wallet_cap_update");
    assert.equal(row.outcome, "rejected_other");
    assert.match(row.reason ?? "", /cap_raise_rejected/);
  });

  void it("records an honored set_cap as a success row", async () => {
    await call(
      "manage_wallet",
      { action: "set_cap", dailyCapUsd: 50 },
      { ok: true, data: { address: WALLET, dailyCapUsd: "50.00", status: "active" } },
    );
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].action, "agent_wallet_cap_update");
    assert.equal(inserted[0].outcome, "success");
  });

  void it("caps oversized args instead of storing unbounded params", async () => {
    const args = { to: "0x0000000000000000000000000000000000000002", junk: "x".repeat(10_000) };
    await call("send", args, { ok: false, error: "boom" });
    assert.equal(inserted.length, 1);
    const params = inserted[0].params;
    assert.equal(params["tool"], "send");
    assert.equal(params["args"], undefined);
    const truncated = params["argsTruncated"];
    assert.equal(typeof truncated, "string");
    assert.ok((truncated as string).length <= 2_000);
    assert.ok(JSON.stringify(params).length < 3_000);
  });
});
