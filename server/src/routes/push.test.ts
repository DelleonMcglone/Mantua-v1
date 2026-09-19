import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { createPushRouter } = await import("./push.ts");
type DispatchDeps = import("../lib/push/dispatch.ts").DispatchDeps;

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const KEYS = { p256dh: "B".repeat(87), auth: "a".repeat(22) };

function serve(opts: { authed: boolean; enabled: boolean }) {
  const rows = new Map<string, { userId: string; topics: unknown }>();
  const sent: string[] = [];
  const dispatch: DispatchDeps = {
    keys: opts.enabled ? { publicKey: "PUB", privateKey: "x", subject: "mailto:a@b.c" } : null,
    store: {
      subscriptionsFor: (userId) =>
        Promise.resolve(
          [...rows.entries()]
            .filter(([, r]) => r.userId === userId)
            .map(([endpoint, r]) => ({ endpoint, p256dh: "k", auth: "a", topics: r.topics })),
        ),
      claimDelivery: () => Promise.resolve(true),
      remove: () => Promise.resolve(),
    },
    send: (sub, message) => {
      sent.push(`${sub.endpoint}:${message.tag}`);
      return Promise.resolve({ status: "sent" as const });
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (opts.authed) req.privyUserId = "did:privy:u";
    next();
  });
  app.use(
    createPushRouter({
      ensureUser: () => Promise.resolve("usr_1"),
      dispatch: () => dispatch,
      upsert: (row) => {
        rows.set(row.endpoint, { userId: row.userId, topics: row.topics ?? {} });
        return Promise.resolve();
      },
      updateTopics: (userId, endpoint, topics) => {
        const r = rows.get(endpoint);
        if (!r || r.userId !== userId) return Promise.resolve(false);
        r.topics = topics;
        return Promise.resolve(true);
      },
      remove: (_u, endpoint) => {
        rows.delete(endpoint);
        return Promise.resolve();
      },
      topics: (_u, endpoint) => Promise.resolve(rows.get(endpoint)?.topics ?? null),
    }),
  );
  return new Promise<{ origin: string; rows: typeof rows; sent: string[] }>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no port");
      resolve({ origin: `http://127.0.0.1:${String(addr.port)}`, rows, sent });
    });
  });
}
const call = (origin: string, path: string, method: string, body?: unknown) =>
  fetch(`${origin}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

void describe("push routes (MX-004)", () => {
  void it("subscribes, edits topics, sends a test, and forgets the browser", async () => {
    const { origin, rows, sent } = await serve({ authed: true, enabled: true });
    const config = (await (await call(origin, "/api/push/config", "GET")).json()) as {
      enabled: boolean;
      publicKey: string;
    };
    assert.equal(config.enabled, true);
    assert.equal(config.publicKey, "PUB");

    const sub = await call(origin, "/api/push/subscribe", "POST", {
      endpoint: ENDPOINT,
      keys: KEYS,
      topics: { games: false },
    });
    assert.equal(sub.status, 201);
    assert.deepEqual(rows.get(ENDPOINT), { userId: "usr_1", topics: { games: false } });

    const patch = await call(origin, "/api/push/topics", "PATCH", {
      endpoint: ENDPOINT,
      topics: { games: true, agent: false },
    });
    assert.equal(patch.status, 200);
    assert.deepEqual(rows.get(ENDPOINT)?.topics, { games: true, agent: false });
    assert.equal(
      (await call(origin, "/api/push/topics", "PATCH", { endpoint: "https://x.y/z", topics: {} }))
        .status,
      404,
    );

    const test = (await (await call(origin, "/api/push/test", "POST", {})).json()) as {
      outcome: string;
      sent: number;
    };
    assert.equal(test.outcome, "sent");
    assert.equal(test.sent, 1);
    assert.match(sent[0], /^https:\/\/fcm\.googleapis\.com\/fcm\/send\/abc:test:/);

    assert.equal(
      (await call(origin, "/api/push/subscribe", "DELETE", { endpoint: ENDPOINT })).status,
      200,
    );
    assert.equal(rows.size, 0);
  });

  void it("refuses a malformed subscription, an unknown topic, and an anonymous caller", async () => {
    const { origin } = await serve({ authed: true, enabled: true });
    assert.equal(
      (
        await call(origin, "/api/push/subscribe", "POST", {
          endpoint: "http://insecure/x",
          keys: KEYS,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(origin, "/api/push/subscribe", "POST", {
          endpoint: ENDPOINT,
          keys: { p256dh: "short", auth: KEYS.auth },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(origin, "/api/push/subscribe", "POST", {
          endpoint: ENDPOINT,
          keys: KEYS,
          topics: { gas: true },
        })
      ).status,
      400,
    );
    const anon = await serve({ authed: false, enabled: true });
    assert.equal(
      (await call(anon.origin, "/api/push/subscribe", "POST", { endpoint: ENDPOINT, keys: KEYS }))
        .status,
      401,
    );
  });

  void it("answers 503 and stores nothing when the deployment has no keys", async () => {
    const { origin, rows } = await serve({ authed: true, enabled: false });
    const config = (await (await call(origin, "/api/push/config", "GET")).json()) as {
      enabled: boolean;
      publicKey: null;
    };
    assert.deepEqual([config.enabled, config.publicKey], [false, null]);
    assert.equal(
      (await call(origin, "/api/push/subscribe", "POST", { endpoint: ENDPOINT, keys: KEYS }))
        .status,
      503,
    );
    assert.equal((await call(origin, "/api/push/test", "POST", {})).status, 503);
    assert.equal(rows.size, 0);
  });
});
