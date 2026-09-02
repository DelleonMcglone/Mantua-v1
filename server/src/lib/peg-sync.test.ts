import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pegDriftBps } from "./peg-sync.ts";

const X18 = 10n ** 18n;

void describe("pegDriftBps", () => {
  void it("reads an unset on-chain ref (0) as infinite drift so it always writes", () => {
    assert.equal(pegDriftBps(1_141_480_000_000_000_000n, 0n), Number.POSITIVE_INFINITY);
  });

  void it("returns 0 for identical values", () => {
    assert.equal(pegDriftBps(X18, X18), 0);
  });

  void it("computes drift in bps of the on-chain ref, either direction", () => {
    // 1.0000 -> 1.0010 live: 10 bps.
    assert.equal(pegDriftBps((X18 * 10_010n) / 10_000n, X18), 10);
    // 1.0010 on-chain, 1.0000 live: also ~9 bps (floor of 10/1.001).
    assert.equal(pegDriftBps(X18, (X18 * 10_010n) / 10_000n), 9);
  });

  void it("stays exact for realistic EUR/USD magnitudes", () => {
    const onchain = 1_141_480_000_000_000_000n; // 1.14148
    const live = 1_142_621_480_000_000_000n; // +10 bps exactly
    assert.equal(pegDriftBps(live, onchain), 10);
  });
});
