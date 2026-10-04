import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";
process.env.CRON_SECRET = "test-cron-secret-0123456789";

const { createWaitlistRouter, createWaitlistExportRouter, waitlistCsv } =
  await import("./waitlist.ts");

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

void describe("GET /api/ops/waitlist.csv", () => {
  void it("quotes awkward cells and dates rows in ISO", () => {
    const csv = waitlistCsv([
      { email: "a@b.co", source: "landing", createdAt: new Date("2026-10-04T10:00:00Z") },
      { email: 'we"ird,@b.co', source: "landing", createdAt: new Date("2026-10-04T11:00:00Z") },
    ]);
    assert.equal(
      csv,
      'email,source,created_at\na@b.co,landing,2026-10-04T10:00:00.000Z\n"we""ird,@b.co",landing,2026-10-04T11:00:00.000Z\n',
    );
  });

  void it("refuses without the cron secret and serves a CSV attachment with it", async () => {
    const app = express();
    app.use(
      createWaitlistExportRouter({
        list: () =>
          Promise.resolve([
            { email: "a@b.co", source: "landing", createdAt: new Date("2026-10-04T10:00:00Z") },
          ]),
      }),
    );
    const origin = await new Promise<string>((resolve) => {
      const server = app.listen(0, "127.0.0.1", () => {
        servers.push(server);
        const addr = server.address();
        if (addr === null || typeof addr === "string") throw new Error("no port");
        resolve(`http://127.0.0.1:${String(addr.port)}`);
      });
    });
    const anon = await fetch(`${origin}/api/ops/waitlist.csv`);
    assert.equal(anon.status, 401);
    const ok = await fetch(`${origin}/api/ops/waitlist.csv`, {
      headers: { authorization: "Bearer test-cron-secret-0123456789" },
    });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(ok.headers.get("content-disposition") ?? "", /mantua-waitlist\.csv/);
    assert.equal(
      await ok.text(),
      "email,source,created_at\na@b.co,landing,2026-10-04T10:00:00.000Z\n",
    );
  });
});
