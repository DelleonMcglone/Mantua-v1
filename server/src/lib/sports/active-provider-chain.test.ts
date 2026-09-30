/**
 * R-012 — provider chains with a TRIAL Sportradar key configured.
 *
 * The 2026-09-26 incident: the five-minute live tick burned the trial
 * key's 1,000-call rolling window in three days, and with Sportradar the
 * only provider the tick knew, the feed went dark for four days. Pinned
 * here: on a trial key the live tick reads ESPN only, while the daily and
 * settlement reads keep Sportradar first with ESPN behind it. Runs in its
 * own process so the env module loads with the key set.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";
process.env.SPORTRADAR_API_KEY = "test-trial-key";
process.env.SPORTRADAR_ENV = "trial";

const { liveProviderChainFor, providerChainFor } = await import("./active-provider.ts");

void describe("provider chains — trial Sportradar key", () => {
  void it("daily/settlement reads: Sportradar first, ESPN behind it", () => {
    assert.deepEqual(
      providerChainFor("nfl").map((p) => p.name),
      ["sportradar", "espn"],
    );
  });

  void it("the live tick reads ESPN only — the trial quota is reserved for the daily sync", () => {
    assert.deepEqual(
      liveProviderChainFor("nfl").map((p) => p.name),
      ["espn"],
    );
  });

  void it("a league Sportradar does not cover is ESPN-only in both chains", () => {
    assert.deepEqual(
      providerChainFor("wnba").map((p) => p.name),
      ["espn"],
    );
    assert.deepEqual(
      liveProviderChainFor("wnba").map((p) => p.name),
      ["espn"],
    );
  });
});
