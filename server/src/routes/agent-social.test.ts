import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

/**
 * Task 070 / AE-001, AE-006 — /api/agent/social boundary: the patch is
 * validated strictly (handle rule, policy ranges), a bad post id is 400,
 * and an in-range request reaches the lib layer (409 without a user
 * record). Style: `routes/agent-policy.test.ts`.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { agentSocialRouter } = await import("./agent-social.ts");
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
  app.use(agentSocialRouter);
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
    from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
  });
}

async function send(
  origin: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

void describe("/api/agent/social", () => {
  void it("PATCH rejects an empty patch, a bad handle, an unknown key and an out-of-range cadence", async () => {
    const origin = await serve();
    for (const body of [
      {},
      { handle: "Bad Handle" },
      { nickname: "x" },
      { postingPolicy: { maxPostsPerHour: 99 } },
      { postingPolicy: { templates: ["nope"] } },
    ]) {
      const res = await send(origin, "PATCH", "/api/agent/social", body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(((await res.json()) as { code?: string }).code, "BAD_REQUEST");
    }
  });

  void it("a post decision with a malformed id is 400 before any lookup", async () => {
    const origin = await serve();
    const res = await send(origin, "POST", "/api/agent/social/posts/not-a-uuid/approve", {});
    assert.equal(res.status, 400);
  });

  void it("an in-range patch, the reads and a well-formed decision reach the lib layer (409 without a user record)", async () => {
    const origin = await serve();
    stubNoUser();
    const patch = await send(origin, "PATCH", "/api/agent/social", {
      handle: "sideline_sage",
      displayName: "Sage",
    });
    assert.equal(patch.status, 409);
    assert.equal(((await patch.json()) as { code?: string }).code, "USER_NOT_FOUND");
    assert.equal((await send(origin, "GET", "/api/agent/social")).status, 409);
    assert.equal((await send(origin, "GET", "/api/agent/social/posts")).status, 409);
    const decision = await send(
      origin,
      "POST",
      "/api/agent/social/posts/8f1c2a3e-5b6d-4c7e-9f01-234567890abc/reject",
      {},
    );
    assert.equal(decision.status, 409);
  });
});
