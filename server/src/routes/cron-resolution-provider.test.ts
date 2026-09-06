/**
 * Task 044 (D-104) — settlement routes through `providerFor(league)`, the
 * same canonical provider selection every other consumer uses, instead of
 * the shipped `new EspnProvider()` bypass that settled finals off the
 * prototyping fallback even where Sportradar was configured.
 *
 * `SPORTRADAR_API_KEY` is set BEFORE the env module loads (each test file
 * runs in its own process), so this process's provider routing is the
 * "licensed provider configured" world:
 *  - NFL (covered by the Sportradar package) → the sportradar adapter;
 *  - WNBA (no licensed package) → the espn fallback — the ONLY way ESPN is
 *    reached, as the configured fallback rather than a hardcoded default.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";
process.env.SPORTRADAR_API_KEY = "stub-sportradar-key";

const { resolutionProviderFor } = await import("./cron-resolution.ts");

void describe("cron-resolution provider routing (D-104)", () => {
  void it("consults the Sportradar-backed provider for a Sportradar-covered league", () => {
    assert.equal(resolutionProviderFor("nfl").name, "sportradar");
  });

  void it("falls back to ESPN only where the licensed provider does not cover the league", () => {
    assert.equal(resolutionProviderFor("wnba").name, "espn");
  });
});
