import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { createLegalRouter } = await import("./legal.ts");
const { TERMS_VERSION, acceptanceStatus } = await import("../lib/legal.ts");
type AcceptanceRow = import("../lib/legal.ts").AcceptanceRow;

/**
 * Task 067 (G-014) — the real router over an in-memory acceptance store:
 * a fresh user is not current; accepting the current version records
 * once (a replay is a no-op); an older version is refused; anonymous
 * requests are refused.
 */
const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

function serve(authed: boolean): Promise<{ origin: string; rows: AcceptanceRow[] }> {
  const rows: AcceptanceRow[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (authed) req.privyUserId = "did:privy:test-user";
    next();
  });
  app.use(
    createLegalRouter({
      ensureUser: () => Promise.resolve("usr_1"),
      list: () => Promise.resolve(rows),
      record: (_userId, doc, version) => {
        if (!rows.some((r) => r.doc === doc && r.version === version)) {
          rows.push({ doc, version, acceptedAt: new Date("2026-09-13T00:00:00Z") });
        }
        return Promise.resolve();
      },
    }),
  );
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve({ origin: `http://127.0.0.1:${String(addr.port)}`, rows });
    });
  });
}

void describe("legal acceptance (G-014)", () => {
  void it("a fresh user is not current, accepts once, and a replay is a no-op", async () => {
    const { origin, rows } = await serve(true);
    const before = (await (await fetch(`${origin}/api/legal/acceptance`)).json()) as {
      terms: { current: boolean; version: string; acceptedVersion: string | null };
    };
    assert.equal(before.terms.current, false);
    assert.equal(before.terms.version, TERMS_VERSION);
    assert.equal(before.terms.acceptedVersion, null);

    const post = (body: unknown) =>
      fetch(`${origin}/api/legal/acceptance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal((await post({ doc: "terms", version: TERMS_VERSION })).status, 201);
    assert.equal((await post({ doc: "terms", version: TERMS_VERSION })).status, 201);
    assert.equal(rows.length, 1, "one row per (user, doc, version)");

    const after = (await (await fetch(`${origin}/api/legal/acceptance`)).json()) as {
      terms: { current: boolean; acceptedVersion: string | null };
    };
    assert.equal(after.terms.current, true);
    assert.equal(after.terms.acceptedVersion, TERMS_VERSION);
  });

  void it("refuses an older version, an unknown document, and anonymous callers", async () => {
    const { origin } = await serve(true);
    const stale = await fetch(`${origin}/api/legal/acceptance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc: "terms", version: "2026-01-01" }),
    });
    assert.equal(stale.status, 409);
    assert.equal(((await stale.json()) as { code: string }).code, "STALE_VERSION");
    const unknown = await fetch(`${origin}/api/legal/acceptance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc: "eula", version: TERMS_VERSION }),
    });
    assert.equal(unknown.status, 400);
    const anon = await serve(false);
    assert.equal((await fetch(`${anon.origin}/api/legal/acceptance`)).status, 401);
  });

  void it("acceptanceStatus picks the newest accepted version", () => {
    const s = acceptanceStatus("terms", [
      { doc: "terms", version: "2026-08-15", acceptedAt: new Date(0) },
      { doc: "privacy", version: TERMS_VERSION, acceptedAt: new Date(0) },
    ]);
    assert.equal(s.acceptedVersion, "2026-08-15");
    assert.equal(s.current, false);
  });
});
