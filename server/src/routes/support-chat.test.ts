import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";

/**
 * Task 070 / AE-007 — /api/support/* boundary: validation, the
 * no-model 503, and that anonymous traffic is accepted (no auth gate).
 * Style: `routes/agent-policy.test.ts`.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";
delete process.env.ANTHROPIC_API_KEY;

const { supportChatRouter } = await import("./support-chat.ts");

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

function serve(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(supportChatRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

async function post(origin: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

void describe("/api/support", () => {
  void it("rejects an empty message, an oversized history and a bad channel with the 400 envelope", async () => {
    const origin = await serve();
    for (const body of [
      { message: "" },
      { message: "hi", history: Array.from({ length: 21 }, () => ({ role: "user", text: "x" })) },
      { message: "hi", channel: "Bad Channel!" },
    ]) {
      const res = await post(origin, "/api/support/chat", body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(((await res.json()) as { code?: string }).code, "BAD_REQUEST");
    }
  });

  void it("answers 503 ANTHROPIC_UNAVAILABLE on both channels without a model key, anonymously", async () => {
    const origin = await serve();
    for (const path of ["/api/support/chat", "/api/support/message"]) {
      const res = await post(origin, path, { message: "how do deposits work" });
      assert.equal(res.status, 503, path);
      assert.equal(((await res.json()) as { code?: string }).code, "ANTHROPIC_UNAVAILABLE");
    }
  });
});
