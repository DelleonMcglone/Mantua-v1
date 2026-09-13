import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Task 067 (G-007) — every mutating route registration carries a guard.
 *
 * A static audit over `server/src/routes/*.ts`: each `.post( / .patch( /
 * .put( / .delete(` registration must name one of the guards in its
 * middleware list, or be listed below with the reason it is deliberately
 * open. A new unguarded route fails this test instead of waiting for a
 * reviewer to notice. The global kill switch and IP limiter still apply
 * to everything (app.ts); this is about identity.
 */
const GUARDS = [
  "requireAuth",
  "requireCronSecret",
  "requireOpsAuth",
  "verifyCircleWebhook",
  "verifyFiatWebhook",
  "freeAnalystQuota",
];

/** Deliberately open registrations, each with its reason. */
const ALLOWLIST: { file: string; path: string; reason: string }[] = [
  {
    file: "rpc-proxy.ts",
    path: "/api/rpc",
    reason: "read-only JSON-RPC proxy with a method allowlist; IP rate-limited; no state",
  },
  {
    file: "circle-webhook.ts",
    path: "/api/circle/webhook",
    reason: "signature verified inside the handler against Circle's public key",
  },
  {
    file: "fiat-webhook.ts",
    path: "/api/fiat/webhook",
    reason: "HMAC verified inside the handler over the raw body",
  },
];

const ROUTES_DIR = import.meta.dirname;
const REGISTRATION =
  /\.(post|patch|put|delete)\(\s*(["'`])([^"'`]+)\2([\s\S]*?)(?=\basync\b|\(\s*req\b|\(\s*_req\b|function\b)/g;

interface Registration {
  file: string;
  method: string;
  path: string;
  middleware: string;
}

function registrations(): Registration[] {
  const out: Registration[] = [];
  for (const file of readdirSync(ROUTES_DIR)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(ROUTES_DIR, file), "utf8");
    for (const m of source.matchAll(REGISTRATION)) {
      out.push({ file, method: m[1], path: m[3], middleware: m[4] });
    }
  }
  return out;
}

void describe("route guards (launch gate G-007)", () => {
  void it("finds the mutating registrations", () => {
    const regs = registrations();
    assert.ok(regs.length >= 20, `expected many mutating routes, found ${String(regs.length)}`);
    assert.ok(regs.some((r) => r.path === "/api/markets/trade/calldata"));
  });

  void it("every mutating route names a guard or is allowlisted with a reason", () => {
    const unguarded = registrations().filter((r) => !GUARDS.some((g) => r.middleware.includes(g)));
    const unexplained = unguarded.filter(
      (r) => !ALLOWLIST.some((a) => a.file === r.file && a.path === r.path),
    );
    assert.deepEqual(
      unexplained.map((r) => `${r.file} ${r.method.toUpperCase()} ${r.path}`),
      [],
      "unguarded mutating routes without an allowlist entry",
    );
    for (const a of ALLOWLIST) {
      assert.ok(a.reason.length > 20, `${a.path}: state the reason`);
    }
  });

  void it("the allowlist only names routes that still exist", () => {
    const regs = registrations();
    for (const a of ALLOWLIST) {
      assert.ok(
        regs.some((r) => r.file === a.file && r.path === a.path),
        `${a.file} ${a.path} is allowlisted but not registered — drop the entry`,
      );
    }
  });
});
