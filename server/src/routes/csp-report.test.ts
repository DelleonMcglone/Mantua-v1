/**
 * Task 067 — the CSP report route accepts both browser content types at
 * the path the policy names, logs the reduced record, and never errors.
 */
import assert from "node:assert/strict";
import express from "express";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { CSP_REPORT_PATH } from "../lib/security/csp.ts";
import type { CspViolation } from "../lib/security/csp-report.ts";
import { createCspReportRouter } from "./csp-report.ts";

const logged: CspViolation[] = [];
let server: Server;
let origin = "";

before(async () => {
  const app = express();
  app.use(createCspReportRouter({ log: (v) => logged.push(v) }));
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

void describe("POST /api/csp-report", () => {
  void it("accepts the legacy content type at the path the policy names", async () => {
    const res = await fetch(`${origin}${CSP_REPORT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify({
        "csp-report": { "document-uri": "https://app/", "effective-directive": "script-src" },
      }),
    });
    assert.equal(res.status, 204);
    assert.equal(logged.at(-1)?.effectiveDirective, "script-src");
  });

  void it("accepts the Reporting API content type", async () => {
    const res = await fetch(`${origin}${CSP_REPORT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/reports+json" },
      body: JSON.stringify([
        {
          type: "csp-violation",
          body: { documentURL: "https://app/", effectiveDirective: "img-src" },
        },
      ]),
    });
    assert.equal(res.status, 204);
    assert.equal(logged.at(-1)?.effectiveDirective, "img-src");
  });

  void it("swallows malformed bodies without logging or failing", async () => {
    const count = logged.length;
    const res = await fetch(`${origin}${CSP_REPORT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: "{}",
    });
    assert.equal(res.status, 204);
    assert.equal(logged.length, count);
  });
});
