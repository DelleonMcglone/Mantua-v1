import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { createWaitlistRouter } = await import("./waitlist.ts");

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

function serve(
  save: (row: { email: string; source: string; userAgent: string | null }) => Promise<boolean>,
) {
  const app = express();
  app.use(express.json());
  app.use(createWaitlistRouter({ save }));
  return new Promise<string>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

const post = (origin: string, body: unknown) =>
  fetch(`${origin}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "test-ua" },
    body: JSON.stringify(body),
  });

void describe("POST /api/waitlist", () => {
  void it("stores a lower-cased, trimmed email and says so", async () => {
    const seen: { email: string; source: string; userAgent: string | null }[] = [];
    const origin = await serve((row) => {
      seen.push(row);
      return Promise.resolve(true);
    });
    const res = await post(origin, { email: "  Fan@Example.COM " });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, already: false });
    assert.deepEqual(seen, [{ email: "fan@example.com", source: "landing", userAgent: "test-ua" }]);
  });

  void it("treats a repeat email as already on the list, not an error", async () => {
    const origin = await serve(() => Promise.resolve(false));
    const res = await post(origin, { email: "fan@example.com" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, already: true });
  });

  void it("rejects a malformed email with 400 and never touches the store", async () => {
    let calls = 0;
    const origin = await serve(() => {
      calls += 1;
      return Promise.resolve(true);
    });
    for (const email of ["", "nope", "a@b", "x".repeat(250) + "@e.com", 42]) {
      const res = await post(origin, { email });
      assert.equal(res.status, 400, String(email).slice(0, 20));
    }
    assert.equal(calls, 0);
  });
});
