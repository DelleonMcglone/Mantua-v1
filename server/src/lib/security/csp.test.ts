/**
 * Task 067 — the report-only CSP is complete, secure by construction, and
 * identical between the builder and the hosting config.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CSP_REPORT_PATH, CSP_SOURCES, buildCsp, cspDirectives } from "./csp.ts";

const ROOT = new URL("../../../../", import.meta.url);

function vercelHeaders(): Record<string, string> {
  const cfg = JSON.parse(readFileSync(new URL("vercel.json", ROOT), "utf8")) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const all = cfg.headers.find((h) => h.source === "/(.*)");
  assert.ok(all, "vercel.json must carry a catch-all headers block");
  return Object.fromEntries(all.headers.map((h) => [h.key, h.value]));
}

void describe("report-only CSP", () => {
  void it("every allowlisted origin is https or wss and states why", () => {
    for (const [directive, sources] of Object.entries(CSP_SOURCES)) {
      for (const s of sources) {
        assert.match(s.origin, /^(https|wss):\/\/[a-z0-9*.-]+$/, `${directive}: ${s.origin}`);
        assert.ok(s.why.length > 8, `${directive}: ${s.origin} needs a reason`);
      }
    }
  });

  void it("never allows eval, inline scripts, or plugins", () => {
    const policy = buildCsp();
    assert.doesNotMatch(policy, /'unsafe-eval'/);
    assert.doesNotMatch(/script-src[^;]*/.exec(policy)?.[0] ?? "", /'unsafe-inline'/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /base-uri 'self'/);
    assert.match(policy, /form-action 'self'/);
  });

  void it("reports to the server route", () => {
    assert.equal(cspDirectives().at(-1), `report-uri ${CSP_REPORT_PATH}`);
  });

  void it("is the exact header vercel.json ships", () => {
    assert.equal(vercelHeaders()["Content-Security-Policy-Report-Only"], buildCsp());
  });

  void it("does not enforce yet (no plain Content-Security-Policy header)", () => {
    assert.equal(vercelHeaders()["Content-Security-Policy"], undefined);
  });
});
