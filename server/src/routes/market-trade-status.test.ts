/**
 * Phase 7 / R-004 — GET /api/markets/trade/status: the server-verified
 * state of a submitted trade. Four states, never ambiguous: confirmed,
 * failed, pending (known to the network, unmined), unknown (never seen).
 * Driven through the real fills router with the receipt reader and the
 * fill store faked at its seams.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { createMarketFillsRouter } = await import("./market-fills.ts");
type MarketFillsDeps = import("./market-fills.ts").MarketFillsDeps;

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

const ROUTER = "0x00000000000000000000000000000000000000f1";
const WALLET = "0x00000000000000000000000000000000000000aa";
const CONFIRMED = `0x${"1".repeat(64)}`;
const REVERTED = `0x${"2".repeat(64)}`;
const PENDING = `0x${"3".repeat(64)}`;
const UNKNOWN = `0x${"4".repeat(64)}`;

function serve(recorded: Set<string>): Promise<string> {
  const rpc: MarketFillsDeps["rpc"] = () => ({
    getTransactionReceipt: ({ hash }) => {
      if (hash === CONFIRMED) return Promise.resolve({ status: "success", logs: [] });
      if (hash === REVERTED) return Promise.resolve({ status: "reverted", logs: [] });
      return Promise.reject(new Error("TransactionReceiptNotFoundError"));
    },
    getTransaction: ({ hash }) => {
      if (hash === UNKNOWN) return Promise.reject(new Error("TransactionNotFoundError"));
      return Promise.resolve({ to: ROUTER, from: WALLET });
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.privyUserId = "did:privy:test-user";
    req.walletAddress = WALLET;
    next();
  });
  app.use(
    createMarketFillsRouter({
      rpc,
      swapRouterFor: () => ROUTER,
      hookFor: () => null,
      insertFill: () => Promise.resolve(true),
      fillExists: (txHash) => Promise.resolve(recorded.has(txHash)),
      recordArtifacts: () => Promise.resolve(),
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

async function status(origin: string, txHash: string) {
  const res = await fetch(`${origin}/api/markets/trade/status?txHash=${txHash}&chainId=8453`);
  return {
    status: res.status,
    body: (await res.json()) as { state?: string; recorded?: boolean; code?: string },
  };
}

void describe("GET /api/markets/trade/status (R-004)", () => {
  void it("maps receipt success → confirmed, receipt reverted → failed, known-unmined → pending, never-seen → unknown", async () => {
    const origin = await serve(new Set([CONFIRMED]));
    assert.deepEqual((await status(origin, CONFIRMED)).body, {
      txHash: CONFIRMED,
      state: "confirmed",
      recorded: true,
    });
    assert.deepEqual((await status(origin, REVERTED)).body, {
      txHash: REVERTED,
      state: "failed",
      recorded: false,
    });
    assert.deepEqual((await status(origin, PENDING)).body, {
      txHash: PENDING,
      state: "pending",
      recorded: false,
    });
    assert.deepEqual((await status(origin, UNKNOWN)).body, {
      txHash: UNKNOWN,
      state: "unknown",
      recorded: false,
    });
  });

  void it("a confirmed trade whose fill was never reported shows recorded=false so the client re-reports it", async () => {
    const origin = await serve(new Set());
    const r = await status(origin, CONFIRMED);
    assert.equal(r.body.state, "confirmed");
    assert.equal(r.body.recorded, false);
  });

  void it("rejects a malformed hash with 400 and never caches the answer", async () => {
    const origin = await serve(new Set());
    const bad = await fetch(`${origin}/api/markets/trade/status?txHash=0x123`);
    assert.equal(bad.status, 400);
    const ok = await fetch(`${origin}/api/markets/trade/status?txHash=${PENDING}`);
    assert.equal(ok.headers.get("cache-control"), "no-store");
  });
});
