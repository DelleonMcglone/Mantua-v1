import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import { HSTS_VALUE, isSecureRequest, securityHeaders } from "./security-headers.ts";

/**
 * Task 067 (G-006) — every API response carries the header set; HSTS
 * only over TLS; authenticated responses default to no-store unless the
 * route says otherwise.
 */
const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

function serve(): Promise<string> {
  const app = express();
  app.use(securityHeaders);
  app.get("/plain", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/public", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=15");
    res.json({ ok: true });
  });
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      servers.push(server);
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("no ephemeral port");
      resolve(`http://127.0.0.1:${String(addr.port)}`);
    });
  });
}

void describe("securityHeaders", () => {
  void it("sets the fixed header set on every response", async () => {
    const origin = await serve();
    const res = await fetch(`${origin}/plain`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.match(res.headers.get("permissions-policy") ?? "", /camera=\(\)/);
    assert.equal(res.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(res.headers.get("strict-transport-security"), null, "plain HTTP: no HSTS");
    assert.equal(res.headers.get("cache-control"), null, "anonymous: no default cache header");
  });

  void it("pins HSTS when the platform says the hop was TLS", async () => {
    const origin = await serve();
    const res = await fetch(`${origin}/plain`, { headers: { "x-forwarded-proto": "https" } });
    assert.equal(res.headers.get("strict-transport-security"), HSTS_VALUE);
  });

  void it("defaults authenticated responses to no-store, overridable by the route", async () => {
    const origin = await serve();
    const auth = { authorization: "Bearer t" };
    const plain = await fetch(`${origin}/plain`, { headers: auth });
    assert.equal(plain.headers.get("cache-control"), "no-store");
    const pub = await fetch(`${origin}/public`, { headers: auth });
    assert.equal(pub.headers.get("cache-control"), "public, max-age=15");
  });

  void it("isSecureRequest reads req.secure and the first forwarded proto", () => {
    assert.equal(isSecureRequest({ secure: true, headers: {} }), true);
    assert.equal(isSecureRequest({ headers: { "x-forwarded-proto": "https,http" } }), true);
    assert.equal(isSecureRequest({ headers: { "x-forwarded-proto": ["http"] } }), false);
    assert.equal(isSecureRequest({ headers: {} }), false);
  });
});
