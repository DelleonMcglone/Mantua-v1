import assert from "node:assert/strict";
import express from "express";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { createVoiceTokenRouter } from "./voice-token.ts";
import type { MintOutcome } from "../lib/voice/scribe-token.ts";

/**
 * Task 069 (V-001) — the route contract. The important assertion is the
 * negative one: the response carries the token, its expiry and the model
 * id, and nothing else. A leak of the API key would show up here.
 *
 * `requireAuth` is exercised by injecting the Privy claim the middleware
 * would have set; the mint itself is injected so no key and no network are
 * needed.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

let server: Server;
let origin = "";
let outcome: MintOutcome = {
  status: "ok",
  token: "tok_live",
  expiresAt: 1_700_000_000_000,
  modelId: "scribe_v2_realtime",
};
let authenticated = true;

before(async () => {
  const app = express();
  app.use((req, _res, next) => {
    if (authenticated) req.privyUserId = "did:privy:tester";
    next();
  });
  app.use(createVoiceTokenRouter({ mint: () => Promise.resolve(outcome) }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      origin = typeof addr === "object" && addr ? `http://127.0.0.1:${String(addr.port)}` : "";
      resolve();
    });
  });
});

after(() => {
  server.close();
});

void describe("POST /api/voice/token", () => {
  void it("answers the token, its expiry and the model — and nothing else", async () => {
    authenticated = true;
    outcome = {
      status: "ok",
      token: "tok_live",
      expiresAt: 1_700_000_000_000,
      modelId: "scribe_v2_realtime",
    };

    const res = await fetch(`${origin}/api/voice/token`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");

    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["expiresAt", "modelId", "token"]);
    assert.equal(body.token, "tok_live");
    assert.equal(body.modelId, "scribe_v2_realtime");
  });

  void it("refuses an unauthenticated caller", async () => {
    authenticated = false;
    const res = await fetch(`${origin}/api/voice/token`, { method: "POST" });
    assert.equal(res.status, 401);
    authenticated = true;
  });

  void it("says voice is off, rather than broken, when no key is configured", async () => {
    outcome = { status: "not_configured", reason: "Voice input is not enabled." };
    const res = await fetch(`${origin}/api/voice/token`, { method: "POST" });
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { code: string }).code, "VOICE_DISABLED");
  });

  void it("maps an exhausted allowance and a throttle to their own codes", async () => {
    outcome = { status: "quota_exceeded", reason: "used up" };
    let res = await fetch(`${origin}/api/voice/token`, { method: "POST" });
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { code: string }).code, "VOICE_QUOTA");

    outcome = { status: "rate_limited", reason: "slow down" };
    res = await fetch(`${origin}/api/voice/token`, { method: "POST" });
    assert.equal(res.status, 429);
    assert.equal(((await res.json()) as { code: string }).code, "RATE_LIMITED");

    outcome = { status: "unauthorized", reason: "bad key" };
    res = await fetch(`${origin}/api/voice/token`, { method: "POST" });
    assert.equal(res.status, 502);
    const body = (await res.json()) as { code: string; error: string };
    assert.equal(body.code, "VOICE_UNAVAILABLE");
    assert.equal(body.error, "bad key", "the reason reaches the client as the message");
  });
});
