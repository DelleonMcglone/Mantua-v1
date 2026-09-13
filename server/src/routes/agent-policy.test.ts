import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

/**
 * Task 057 — /api/agent/policy boundary validation (D-109).
 *
 * Style: `routes/agent-wallets.test.ts` — the real router on an ephemeral
 * express app, auth satisfied by pre-setting req.privyUserId; the drizzle
 * `db.select` facade stubbed so the one in-range request reaches the lib
 * layer (no user record → 409). Under the write limiter's per-process
 * budget, so few requests.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { agentPolicyRouter } = await import("./agent-policy.ts");
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
  app.use(agentPolicyRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

function stubNoUser(): void {
  (db as { select: unknown }).select = () => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve([]) }),
    }),
  });
}

async function patchPolicy(origin: string, body: unknown): Promise<Response> {
  return fetch(`${origin}/api/agent/policy`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

void describe("/api/agent/policy", () => {
  void it("PATCH rejects an empty patch, an unknown key, and an out-of-range stake with the 400 envelope", async () => {
    const origin = await serve();
    for (const body of [{}, { dailyCapUsd: 10 }, { maxStakePerTradeUsd: 0 }]) {
      const res = await patchPolicy(origin, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      const json = (await res.json()) as { code?: string; details?: unknown };
      assert.equal(json.code, "BAD_REQUEST");
      assert.ok(Array.isArray(json.details));
    }
  });

  void it("an in-range patch and a GET reach the lib layer (409 without a user record)", async () => {
    const origin = await serve();
    stubNoUser();
    const res = await patchPolicy(origin, { status: "paused", hedge: { cooldownMinutes: 15 } });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code?: string }).code, "USER_NOT_FOUND");
    const get = await fetch(`${origin}/api/agent/policy`);
    assert.equal(get.status, 409);
  });
});
