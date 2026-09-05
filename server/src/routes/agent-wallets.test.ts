import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

/**
 * 030 — PATCH /api/agent/wallet/cap boundary validation.
 *
 * The library clamp (`assertValidDailyCap`, C-010) rejects `dailyCapUsd: 0`,
 * but the route's zod schema used `.nonnegative()` and let 0 through — the
 * request then surfaced the raw clamp error instead of the standard 400
 * envelope. The schema is now `.positive()`; these tests pin the 400 for 0,
 * negatives, and above-ceiling values, and that an in-range value gets PAST
 * validation (reaching the lib layer, stubbed here to have no user record).
 *
 * Style: matches `routes/x402-service.test.ts` — the real router mounted on
 * an ephemeral express app; auth satisfied by pre-setting req.privyUserId
 * (requireAuth only checks the field). No module mocks; the drizzle `db`
 * facade's `select` is stubbed for the one test that reaches the lib.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { agentWalletsRouter } = await import("./agent-wallets.ts");
const { db } = await import("../db/client.ts");

const servers: Server[] = [];
const realSelect = db.select.bind(db);
after(() => {
  (db as { select: unknown }).select = realSelect;
  for (const s of servers) s.close();
});

function serve(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.privyUserId = "did:privy:test-user";
    next();
  });
  app.use(agentWalletsRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

async function patchCap(origin: string, body: unknown): Promise<Response> {
  return fetch(`${origin}/api/agent/wallet/cap`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

void describe("PATCH /api/agent/wallet/cap — zod boundary", () => {
  void it("rejects dailyCapUsd: 0 with the standard 400 envelope", async () => {
    const origin = await serve();
    const res = await patchCap(origin, { dailyCapUsd: 0 });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code?: string; details?: unknown };
    assert.equal(body.code, "BAD_REQUEST");
    assert.ok(Array.isArray(body.details));
  });

  void it("rejects negative and above-ceiling caps with 400", async () => {
    const origin = await serve();
    for (const dailyCapUsd of [-1, 50_001]) {
      const res = await patchCap(origin, { dailyCapUsd });
      assert.equal(res.status, 400, `dailyCapUsd=${String(dailyCapUsd)}`);
      const body = (await res.json()) as { code?: string };
      assert.equal(body.code, "BAD_REQUEST");
    }
  });

  void it("lets an in-range cap past validation (reaches the lib layer)", async () => {
    // Stub the user lookup to return no rows: validation passing means the
    // route reaches `updateAgentWalletCap`, which then throws
    // UserNotFoundError → 409 USER_NOT_FOUND (NOT a 400).
    (db as { select: unknown }).select = () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });
    try {
      const origin = await serve();
      const res = await patchCap(origin, { dailyCapUsd: 250 });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { code?: string };
      assert.equal(body.code, "USER_NOT_FOUND");
    } finally {
      (db as { select: unknown }).select = realSelect;
    }
  });
});
