/**
 * Task 044 (D-104) — `RESOLUTION_DISPUTE_WINDOW_SECONDS`: defaults to 900,
 * accepts 0 for tests/dev, and a zero window is reported as a deploy hazard
 * by the circleCredentialIssues-style startup check (warn in dev, fatal in
 * production via the shared loadEnv issues machinery).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";
delete process.env.RESOLUTION_DISPUTE_WINDOW_SECONDS;

const { env, resolutionDisputeWindowIssues } = await import("./env.ts");

void describe("RESOLUTION_DISPUTE_WINDOW_SECONDS (D-104)", () => {
  void it("defaults to 900 seconds", () => {
    assert.equal(env.RESOLUTION_DISPUTE_WINDOW_SECONDS, 900);
  });

  void it("flags a zero window as a startup issue, and only a zero window", () => {
    assert.deepEqual(resolutionDisputeWindowIssues(env), []);
    const issues = resolutionDisputeWindowIssues({
      ...env,
      RESOLUTION_DISPUTE_WINDOW_SECONDS: 0,
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0], /dispute window is disabled/);
  });
});
