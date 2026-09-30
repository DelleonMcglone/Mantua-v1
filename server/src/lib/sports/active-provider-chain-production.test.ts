/**
 * R-012 — provider chains with a PRODUCTION Sportradar key: no quota
 * cap, so the live tick reads Sportradar first with ESPN behind it. Own
 * process (env is read at module load).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";
process.env.SPORTRADAR_API_KEY = "test-production-key";
process.env.SPORTRADAR_ENV = "production";

const { liveProviderChainFor, providerChainFor } = await import("./active-provider.ts");

void describe("provider chains — production Sportradar key", () => {
  void it("both the live tick and the daily read go Sportradar → ESPN", () => {
    assert.deepEqual(
      liveProviderChainFor("nfl").map((p) => p.name),
      ["sportradar", "espn"],
    );
    assert.deepEqual(
      providerChainFor("nfl").map((p) => p.name),
      ["sportradar", "espn"],
    );
  });
});
