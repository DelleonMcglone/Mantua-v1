/**
 * B7-004 — /api/liquidity/add/calldata market-pool addressing.
 *
 * With MARKETS_BY_CHAIN empty (no Dynamic Market deployment — simulated
 * here; Base has the real entries), an add against a market pool must return the structured gated
 * response (409, MARKET_POOLS_NOT_DEPLOYED, gated: true) — never succeed
 * and never fail opaquely. Same contract for the remove route's `market`
 * flag. The base-pair path stays byte-compatible (schema errors pinned).
 *
 * Style: matches routes/v4-swap.test.ts — the real routers on an
 * ephemeral express app; auth satisfied by pre-setting req.privyUserId
 * and req.walletAddress.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { liquidityAddRouter } = await import("./liquidity-add.ts");
const { liquidityRemoveRouter } = await import("./liquidity-remove.ts");

// Base carries the real market registries now; these routes are exercised
// in the gated (undeployed) state, so remove the entries for this file and
// put them back when it finishes.
const { UNDEPLOYED, overrideMarketsRegistry } = await import("../lib/testing/markets-registry.ts");
const restoreRegistry = overrideMarketsRegistry(UNDEPLOYED);

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
  restoreRegistry();
});

function serve(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.privyUserId = "did:privy:test-user";
    req.walletAddress = "0x9999999999999999999999999999999999999999";
    next();
  });
  app.use(liquidityAddRouter);
  app.use(liquidityRemoveRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

function post(origin: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

void describe("market-pool liquidity routes surface the gated state (B7-004)", () => {
  void it("add calldata against a market pool → 409 MARKET_POOLS_NOT_DEPLOYED, gated", async () => {
    const origin = await serve();
    const res = await post(origin, "/api/liquidity/add/calldata", {
      market: { providerEventId: "401671789", outcomeIndex: 0 },
      amountYesRaw: "1000000",
      amountUsdcRaw: "1000000",
      deadlineSeconds: 1_900_000_000,
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { code?: string; gated?: boolean; error?: string };
    assert.equal(body.code, "MARKET_POOLS_NOT_DEPLOYED");
    assert.equal(body.gated, true);
    assert.match(body.error ?? "", /not live/i);
  });

  void it("malformed market add body → 400 BAD_REQUEST, not the gated state", async () => {
    const origin = await serve();
    const res = await post(origin, "/api/liquidity/add/calldata", {
      market: { providerEventId: "401671789", outcomeIndex: 2 },
      amountYesRaw: "1000000",
      amountUsdcRaw: "1000000",
      deadlineSeconds: 1_900_000_000,
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "BAD_REQUEST");
  });

  void it("remove calldata flagged as a market position → 409 gated before any on-chain probe", async () => {
    const origin = await serve();
    const res = await post(origin, "/api/liquidity/remove/calldata", {
      tokenId: "1",
      market: { providerEventId: "401671789", outcomeIndex: 1 },
      percentage: 100,
      deadlineSeconds: 1_900_000_000,
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { code?: string; gated?: boolean };
    assert.equal(body.code, "MARKET_POOLS_NOT_DEPLOYED");
    assert.equal(body.gated, true);
  });

  void it("base-pair add body without market key still hits the base-pair schema", async () => {
    const origin = await serve();
    // Missing amounts — must be a schema 400 from the base-pair path.
    const res = await post(origin, "/api/liquidity/add/calldata", {
      tokenA: "USDC",
      tokenB: "EURC",
      fee: 100,
      deadlineSeconds: 1_900_000_000,
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "BAD_REQUEST");
  });
});
