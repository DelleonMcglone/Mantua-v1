import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

/**
 * Task 070 / AE-005, AE-012, AE-014 — the public page boundary: no auth,
 * a malformed or unknown handle is 404 with the same body, and the route
 * accepts no query parameter that could filter the record.
 * Style: `routes/agent-policy.test.ts` (db facade stubbed).
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { agentsPublicRouter } = await import("./agents-public.ts");
const { db } = await import("../db/client.ts");

const servers: Server[] = [];
const realSelect = db.select.bind(db);
after(() => {
  (db as { select: unknown }).select = realSelect;
  for (const s of servers) s.close();
});

function serve(): Promise<string> {
  const app = express();
  app.use(agentsPublicRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

function stubProfiles(rows: unknown[]): void {
  (db as { select: unknown }).select = () => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
  });
}

void describe("/api/agents/:handle", () => {
  void it("answers 404 AGENT_NOT_FOUND for a malformed handle without touching the database", async () => {
    const origin = await serve();
    (db as { select: unknown }).select = () => {
      throw new Error("must not query");
    };
    for (const handle of ["ab", "Bad%20Name", "x".repeat(25)]) {
      const res = await fetch(`${origin}/api/agents/${handle}`);
      assert.equal(res.status, 404, handle);
      assert.equal(((await res.json()) as { code?: string }).code, "AGENT_NOT_FOUND");
    }
  });

  void it("answers the same 404 for an unknown handle and for a private profile", async () => {
    const origin = await serve();
    stubProfiles([]);
    const unknown = await fetch(`${origin}/api/agents/nobody_here`);
    assert.equal(unknown.status, 404);
    const unknownBody = await unknown.text();
    stubProfiles([
      { id: "p1", handle: "quiet_one", isPublic: false, walletAddress: "0xabc", userId: "u1" },
    ]);
    const hidden = await fetch(`${origin}/api/agents/quiet_one`);
    assert.equal(hidden.status, 404);
    assert.equal(await hidden.text(), unknownBody, "private and unknown are indistinguishable");
  });

  void it("upper-cases in the URL are folded to the lower-case handle before the lookup", async () => {
    const origin = await serve();
    const seen = { queried: false };
    (db as { select: unknown }).select = () => ({
      from: () => ({
        where: () => {
          seen.queried = true;
          return { limit: () => Promise.resolve([]) };
        },
      }),
    });
    const res = await fetch(`${origin}/api/agents/Sideline_Sage`);
    assert.equal(res.status, 404);
    // A handle that failed validation never reaches the database; this one did.
    assert.equal(seen.queried, true);
  });
});
