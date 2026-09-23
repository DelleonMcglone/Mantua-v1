/**
 * T-024 — a trade the Dynamic Market Hook refuses reaches the ticket as a
 * distinct typed response, on both the quote and the calldata route, and
 * no longer as the generic 502 QUOTE_FAILED.
 *
 * Kept out of market-trade.test.ts, which sits near the write limiter's
 * per-process request budget. Same harness: the real router on an
 * ephemeral express app with a fake builder that throws the hook error.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express, { type Router } from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { createMarketTradeRouter } = await import("./market-trade.ts");
const { MarketHookRevertError } = await import("../lib/sports/market-hook-errors.ts");

type HookError = InstanceType<typeof MarketHookRevertError>;

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

function serve(router: Router): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.privyUserId = "did:privy:test-user";
    req.walletAddress = "0x00000000000000000000000000000000000000aa";
    next();
  });
  app.use(router);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

function routerThrowing(err: HookError): Router {
  const ok = () => Promise.resolve();
  return createMarketTradeRouter({
    build: () => Promise.reject(err),
    checkCap: ok,
    spendIo: { check: ok, record: ok },
  });
}

async function call(
  err: HookError,
  path: "/api/markets/trade/quote" | "/api/markets/trade/calldata",
): Promise<{ status: number; body: { code?: string; error?: string; details?: unknown } }> {
  const origin = await serve(routerThrowing(err));
  const res = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerEventId: "401547401",
      outcomeIndex: 0,
      direction: "buy",
      amountRaw: "5000000",
    }),
  });
  return { status: res.status, body: (await res.json()) as never };
}

void describe("hook reverts on the market trade routes (T-024)", () => {
  void it("each halt gets its own code on the quote route — none is QUOTE_FAILED", async () => {
    const cases: [HookError, number, string][] = [
      [new MarketHookRevertError("paused"), 503, "MARKET_PAUSED"],
      [new MarketHookRevertError("resolved"), 409, "MARKET_RESOLVED"],
      [new MarketHookRevertError("voided"), 409, "MARKET_VOIDED"],
      [new MarketHookRevertError("frozen"), 409, "MARKET_FROZEN"],
      [new MarketHookRevertError("not_registered"), 503, "MARKET_NOT_OPEN"],
    ];
    for (const [err, status, code] of cases) {
      const res = await call(err, "/api/markets/trade/quote");
      assert.equal(res.status, status, code);
      assert.equal(res.body.code, code);
      assert.ok((res.body.error ?? "").length > 0, code);
    }
  });

  void it("a size-cap revert returns the cap on the calldata route too", async () => {
    const res = await call(
      new MarketHookRevertError("exceeds_cap", { notional: 250_000_000n, cap: 100_000_000n }),
      "/api/markets/trade/calldata",
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "TRADE_EXCEEDS_CAP");
    assert.deepEqual(res.body.details, { notional: "250000000", cap: "100000000" });
  });
});
