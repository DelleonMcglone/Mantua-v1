/**
 * Task 067 — both browser report shapes reduce to the same bounded record;
 * garbage reduces to nothing.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeCspReports } from "./csp-report.ts";

void describe("summarizeCspReports", () => {
  void it("reads the legacy report-uri shape", () => {
    const out = summarizeCspReports({
      "csp-report": {
        "document-uri": "https://app.example/markets",
        "blocked-uri": "https://evil.example/x.js",
        "violated-directive": "script-src",
        "effective-directive": "script-src",
        "source-file": "https://app.example/assets/index.js",
      },
    });
    assert.deepEqual(out, [
      {
        documentUri: "https://app.example/markets",
        blockedUri: "https://evil.example/x.js",
        effectiveDirective: "script-src",
        sourceFile: "https://app.example/assets/index.js",
      },
    ]);
  });

  void it("reads the Reporting API array shape and skips other report types", () => {
    const out = summarizeCspReports([
      { type: "deprecation", body: { id: "x" } },
      {
        type: "csp-violation",
        body: {
          documentURL: "https://app.example/",
          effectiveDirective: "connect-src",
          blockedURL: "wss://x",
        },
      },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.effectiveDirective, "connect-src");
    assert.equal(out[0]?.blockedUri, "wss://x");
    assert.equal(out[0]?.sourceFile, null);
  });

  void it("bounds every field and drops malformed input", () => {
    const long = "a".repeat(1000);
    const out = summarizeCspReports({
      "csp-report": { "document-uri": long, "effective-directive": "img-src" },
    });
    assert.equal(out[0]?.documentUri.length, 200);
    assert.equal(out[0]?.blockedUri, "(none)");
    assert.deepEqual(summarizeCspReports("nope"), []);
    assert.deepEqual(summarizeCspReports({ "csp-report": { "blocked-uri": "x" } }), []);
    assert.deepEqual(summarizeCspReports([{ type: "csp-violation", body: null }]), []);
  });
});
