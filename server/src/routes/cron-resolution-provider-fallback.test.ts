/**
 * Task 044 (D-104) — the companion world to cron-resolution-provider.test:
 * with NO Sportradar key configured, settlement degrades to the ESPN
 * prototyping fallback for every league (D-102's documented degradation),
 * rather than erroring. Runs in its own process, so the env module loads
 * without the key.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";
delete process.env.SPORTRADAR_API_KEY;

const { resolutionProviderFor } = await import("./cron-resolution.ts");

void describe("cron-resolution provider routing — no licensed key", () => {
  void it("degrades every league to the espn fallback", () => {
    assert.equal(resolutionProviderFor("nfl").name, "espn");
    assert.equal(resolutionProviderFor("wnba").name, "espn");
  });
});
