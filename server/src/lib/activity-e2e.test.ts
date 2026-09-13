import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { activity } = await import("../db/schema/activity.ts");
const { hedgeStrategies, marketPositions, resolutions } = await import("../db/schema/markets.ts");
const { kindForAction, listActivity, recordActivity, transitionActivity } =
  await import("./activity.ts");
const { engineExecuted } = await import("./sports/strategy-store.ts");
const { settleResolvedPositions } = await import("./sports/markets-onchain.ts");
const { createMarketFillsRouter } = await import("../routes/market-fills.ts");
type DB = import("../db/client.ts").DB;
type MarketFillsDeps = import("../routes/market-fills.ts").MarketFillsDeps;

/**
 * Phase 9 / PF-021 — the activity end-to-end: every kind of money movement
 * reaches the timeline through the SHIPPED writers, driven against one
 * in-memory store that speaks the drizzle chains they use.
 *
 *   1. a verified user fill through the real fills router → market_buy
 *   2. the agent's trade writer → market_buy by the agent
 *   3. engineExecuted (hedge) → hedge, linked to its strategy
 *   4. settleResolvedPositions → one settlement per settled position
 *   5. the send writer (what recordPendingExecution calls) → a pending
 *      send, moved to completed with its hash exactly once by the
 *      finalizer's transition
 *
 * Then the feed lists all of them. The store applies updates to pending
 * activity rows only (the SQL guard's in-memory analogue).
 */

// ─── The store ───────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const store = new Map<unknown, Row[]>();
let seq = 0;
const rowsOf = (t: unknown): Row[] => {
  let r = store.get(t);
  if (!r) {
    r = [];
    store.set(t, r);
  }
  return r;
};
function chain<T>(value: T): Promise<T> & Record<string, (..._a: unknown[]) => unknown> {
  const p = Promise.resolve(value) as Promise<T> & Record<string, (..._a: unknown[]) => unknown>;
  const self = () => chain(value);
  return Object.assign(p, {
    onConflictDoNothing: self,
    returning: () => Promise.resolve(value),
    limit: () => Promise.resolve(value),
    orderBy: self,
    where: self,
    innerJoin: self,
  });
}
const db = {
  insert: (t: unknown) => ({
    values: (row: Row) => {
      seq += 1;
      const full: Row = {
        id: `row_${String(seq)}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...row,
      };
      rowsOf(t).push(full);
      return chain([full]);
    },
  }),
  update: (t: unknown) => ({
    set: (vals: Row) => ({
      where: () => {
        const rows = rowsOf(t);
        const hit = t === activity ? rows.filter((r) => r["status"] === "pending") : rows;
        for (const r of hit) Object.assign(r, vals);
        return chain(hit);
      },
    }),
  }),
  select: () => ({ from: (t: unknown) => chain(rowsOf(t)) }),
} as unknown as DB;

const USER_WALLET = "0x00000000000000000000000000000000000000aa";
const AGENT_WALLET = "0x00000000000000000000000000000000000000bb";
const MARKET = `0x${"1".repeat(64)}`;
const TX_FILL = `0x${"c".repeat(64)}`;
const TX_AGENT = `0x${"d".repeat(64)}`;
const TX_HEDGE = `0x${"e".repeat(64)}`;
const TX_SEND = `0x${"f".repeat(64)}`;
const ROUTER = "0x00000000000000000000000000000000000000f1";

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

function serveFills(): Promise<string> {
  const rpc: MarketFillsDeps["rpc"] = () => ({
    getTransactionReceipt: () => Promise.resolve({ status: "success", logs: [] }),
    getTransaction: () => Promise.resolve({ to: ROUTER, from: USER_WALLET }),
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.privyUserId = "did:privy:test-user";
    req.walletAddress = USER_WALLET;
    next();
  });
  app.use(
    createMarketFillsRouter({
      rpc,
      swapRouterFor: () => ROUTER,
      hookFor: () => null,
      insertFill: () => Promise.resolve(true),
      fillExists: () => Promise.resolve(false),
      recordArtifacts: () => Promise.resolve(),
      invalidatePositions: () => Promise.resolve(),
      // The real writer, against the in-memory store.
      recordActivity: (_d, input) => recordActivity(db, input),
    }),
  );
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

const activityRows = () => rowsOf(activity);
const ofKind = (kind: string) => activityRows().filter((r) => r["kind"] === kind);

void describe("PF-021 — every money movement reaches the timeline", () => {
  void it("1. a verified user trade → market_buy", async () => {
    const origin = await serveFills();
    const res = await fetch(`${origin}/api/markets/fills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        txHash: TX_FILL,
        marketId: MARKET,
        direction: "buy",
        tokensRaw: "16000000",
        usdcRaw: "10000000",
        chainId: 8453,
      }),
    });
    assert.equal(res.status, 201, await res.text());
    const [buy] = ofKind("market_buy");
    assert.ok(buy, "the fill wrote its entry");
    assert.equal(buy["actor"], "user");
    assert.equal(buy["walletAddress"], USER_WALLET);
    assert.equal(buy["txHash"], TX_FILL);
    assert.equal(buy["valueUsd"], "10.00");
    assert.equal(buy["status"], "completed");
  });

  void it("2. the agent's trade → market_buy by the agent", async () => {
    const kind = kindForAction("agent_market_trade", { direction: "buy" });
    assert.equal(kind, "market_buy");
    const row = await recordActivity(db, {
      kind: "market_buy",
      actor: "agent",
      userId: "usr_1",
      walletAddress: AGENT_WALLET,
      txHash: TX_AGENT,
      marketId: MARKET,
      asset: "YES",
      amountRaw: "8000000",
      valueUsd: 5,
      data: { direction: "buy", confirmationId: "conf_1" },
    });
    assert.ok(row);
    assert.equal(row.actor, "agent");
    assert.equal(row.summary, "Agent bought 8.00 YES for $5.00");
  });

  void it("3. an executed hedge → hedge, linked to its strategy", async () => {
    rowsOf(hedgeStrategies).push({
      id: "stg_1",
      userId: "usr_1",
      marketId: MARKET,
      strategyType: "stop",
      status: "triggered",
    });
    const won = await engineExecuted(
      db,
      "stg_1",
      { action: "close-position", marketId: MARKET, soldRaw: "4000000", usdcOutRaw: "3000000" },
      TX_HEDGE,
    );
    assert.equal(won, true);
    const [hedge] = ofKind("hedge");
    assert.ok(hedge);
    assert.equal(hedge["actor"], "agent");
    assert.equal(hedge["positionRef"], "stg_1");
    assert.equal(hedge["txHash"], TX_HEDGE);
    assert.equal(hedge["valueUsd"], "3.00");
  });

  void it("4. a settled position → settlement", async () => {
    // A losing-side position on a resolved market: it settles at $0 and
    // creates no redeem candidate, so the pass ends after the marks.
    rowsOf(marketPositions).push({
      id: "pos_1",
      marketId: MARKET,
      walletAddress: USER_WALLET,
      side: "no",
      userId: "usr_1",
      size: "16000000",
      redeemedAt: null,
      state: "RESOLVED",
      yesToken: "0x00000000000000000000000000000000000000e1",
      noToken: "0x00000000000000000000000000000000000000e2",
    });
    rowsOf(resolutions).push({ marketId: MARKET, winningOutcomeIndex: 0, createdAt: new Date() });
    const summary = await settleResolvedPositions(db, 8453, {
      executeRedeem: () => Promise.reject(new Error("must not redeem")),
    });
    assert.equal(summary.positionsSettled, 1);
    const [settlement] = ofKind("settlement");
    assert.ok(settlement, "the settled position wrote its entry");
    assert.equal(settlement["actor"], "system");
    assert.equal(settlement["positionRef"], "pos_1");
    assert.equal(settlement["marketId"], MARKET);
  });

  void it("5. a Circle send: pending at acceptance, completed with its hash exactly once", async () => {
    // `recordPendingExecution` writes this entry (keyed by the Circle tx id,
    // no hash yet) through the module's own database handle; here the same
    // writer runs against the store, then the finalizer's transition.
    const pending = await recordActivity(db, {
      kind: "send",
      actor: "agent",
      status: "pending",
      userId: "usr_1",
      walletAddress: AGENT_WALLET,
      refId: "ctx_1",
      asset: "USDC",
      amountRaw: "5000000",
      valueUsd: 5,
      data: { to: "0x4444444444444444444444444444444444444444", circleTxId: "ctx_1" },
    });
    assert.ok(pending);
    assert.equal(pending.status, "pending");
    assert.equal(pending.refId, "ctx_1");
    assert.equal(pending.txHash, null);
    const stored = ofKind("send")[0];
    assert.ok(stored);
    const moved = await transitionActivity(db, { refId: "ctx_1", kind: "send" }, "completed", {
      txHash: TX_SEND,
    });
    assert.equal(moved, true);
    assert.equal(stored["status"], "completed");
    assert.equal(stored["txHash"], TX_SEND);
    const again = await transitionActivity(db, { refId: "ctx_1", kind: "send" }, "failed");
    assert.equal(again, false, "terminal rows never move");
    assert.equal(stored["status"], "completed");
  });

  void it("the feed lists all five", async () => {
    const items = await listActivity(db, {
      userId: "usr_1",
      walletAddresses: [USER_WALLET, AGENT_WALLET],
    });
    const kinds = new Set(items.map((i) => i.kind));
    for (const k of ["market_buy", "hedge", "settlement", "send"]) assert.ok(kinds.has(k), k);
    assert.equal(items.filter((i) => i.kind === "market_buy").length, 2, "user + agent buys");
  });
});
