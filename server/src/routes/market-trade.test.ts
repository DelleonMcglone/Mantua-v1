/**
 * 033 — /api/markets/trade/calldata gating + slippage validation.
 *
 * B7 edge case: with MARKETS_BY_CHAIN empty (this repo state — the Base
 * deployment is pending), a market-pool route must surface the gated
 * state as a typed response (503 MARKETS_NOT_DEPLOYED), never an opaque
 * 502. The sell direction is used so no spending-cap/DB machinery runs —
 * the request path is auth → validation → buildMarketTrade, which throws
 * MarketsNotDeployedError before any RPC.
 *
 * Style: matches `routes/v4-swap.test.ts` — the real router on an
 * ephemeral express app; auth satisfied by pre-setting req.privyUserId
 * (and req.walletAddress, which this route also requires).
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import { MAX_SLIPPAGE_BPS } from "../lib/constants.ts";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { marketTradeRouter } = await import("./market-trade.ts");

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

function serve(withWallet: boolean): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.privyUserId = "did:privy:test-user";
    if (withWallet) req.walletAddress = "0x00000000000000000000000000000000000000aa";
    next();
  });
  app.use(marketTradeRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

function postTrade(origin: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${origin}/api/markets/trade/calldata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerEventId: "401547401",
      outcomeIndex: 0,
      direction: "sell",
      amountRaw: "1000000",
      ...body,
    }),
  });
}

void describe("POST /api/markets/trade/calldata", () => {
  void it("surfaces the gated state (503 MARKETS_NOT_DEPLOYED) while markets are undeployed — not an opaque 502", async () => {
    const origin = await serve(true);
    const res = await postTrade(origin, {});
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string; error?: string };
    assert.equal(body.code, "MARKETS_NOT_DEPLOYED");
    assert.match(body.error ?? "", /not deployed/);
  });

  void it("rejects slippageBps above MAX_SLIPPAGE_BPS with a 400 before any build work", async () => {
    const origin = await serve(true);
    for (const bps of [MAX_SLIPPAGE_BPS + 1, 10_000]) {
      const res = await postTrade(origin, { slippageBps: bps });
      assert.equal(res.status, 400, `slippageBps=${String(bps)}`);
      const body = (await res.json()) as { code?: string };
      assert.equal(body.code, "BAD_REQUEST");
    }
  });

  void it("accepts slippageBps at exactly the cap (fails on the deployment gate, not validation)", async () => {
    const origin = await serve(true);
    const res = await postTrade(origin, { slippageBps: MAX_SLIPPAGE_BPS });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "MARKETS_NOT_DEPLOYED");
  });

  void it("still requires a linked wallet (401 WALLET_REQUIRED)", async () => {
    const origin = await serve(false);
    const res = await postTrade(origin, {});
    assert.equal(res.status, 401);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "WALLET_REQUIRED");
  });
});
