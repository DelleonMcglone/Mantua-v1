/**
 * 031 — /api/v4/swap/calldata slippage hard cap.
 *
 * The schema previously accepted slippageBps up to 10000 (100% — i.e. a
 * min-out of zero). It now clamps at MAX_SLIPPAGE_BPS from
 * lib/constants.ts: above it is a 400 before any quote or calldata work
 * runs. At exactly the cap the request passes validation (pinned here by
 * reaching the next deterministic check — WALLET_REQUIRED — without a
 * wallet on the request).
 *
 * Style: matches `routes/agent-wallets.test.ts` — the real router on an
 * ephemeral express app; auth satisfied by pre-setting req.privyUserId.
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

const { v4SwapRouter } = await import("./v4-swap.ts");

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

function serve(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.privyUserId = "did:privy:test-user";
    next();
  });
  app.use(v4SwapRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

function postCalldata(origin: string, slippageBps: number): Promise<Response> {
  return fetch(`${origin}/api/v4/swap/calldata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tokenIn: "USDC",
      tokenOut: "EURC",
      fee: 500,
      hook: null,
      amountInRaw: "1000000",
      slippageBps,
    }),
  });
}

void describe("POST /api/v4/swap/calldata — slippage clamp", () => {
  void it(`rejects slippageBps above MAX_SLIPPAGE_BPS (${String(MAX_SLIPPAGE_BPS)}) with a 400`, async () => {
    const origin = await serve();
    for (const bps of [MAX_SLIPPAGE_BPS + 1, 1_000, 10_000]) {
      const res = await postCalldata(origin, bps);
      assert.equal(res.status, 400, `slippageBps=${String(bps)}`);
      const body = (await res.json()) as { code?: string };
      assert.equal(body.code, "BAD_REQUEST");
    }
  });

  void it("accepts slippageBps at exactly the cap (fails later on the wallet check, not validation)", async () => {
    const origin = await serve();
    const res = await postCalldata(origin, MAX_SLIPPAGE_BPS);
    // Past zod: the next deterministic gate is the linked-wallet check.
    assert.equal(res.status, 401);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "WALLET_REQUIRED");
  });

  void it("rejects negative and non-integer slippage", async () => {
    const origin = await serve();
    for (const bps of [-1, 12.5]) {
      const res = await postCalldata(origin, bps);
      assert.equal(res.status, 400, `slippageBps=${String(bps)}`);
    }
  });
});
