/**
 * Unit tests for the estimated LP-vs-hook fee split. Pure functions, no
 * network. The split is an approximation (see hook-fee-split.ts); these lock
 * in the math: share derivation, exact-sum invariant, and the no-hook path.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hookShareBps, splitAccruedFees } from "./hook-fee-split.ts";

describe("hookShareBps", () => {
  it("is the fraction of the current fee above the base, in bps", () => {
    // current 1% (10000 pips), base 0.05% (500 pips): (10000-500)/10000 = 95%
    assert.equal(hookShareBps(10_000, 500), 9500);
  });

  it("is 0 when there is no hook (base undefined)", () => {
    assert.equal(hookShareBps(10_000, undefined), 0);
  });

  it("is 0 when the current fee is unknown or non-positive", () => {
    assert.equal(hookShareBps(null, 500), 0);
    assert.equal(hookShareBps(0, 500), 0);
  });

  it("clamps to 0 when the current fee is at/below the base floor", () => {
    assert.equal(hookShareBps(500, 500), 0);
    assert.equal(hookShareBps(300, 500), 0);
  });
});

describe("splitAccruedFees", () => {
  it("splits proportionally and always sums back to the input", () => {
    const a0 = 1_000_000n;
    const a1 = 7n; // odd value to exercise integer-division remainder
    const s = splitAccruedFees(a0, a1, 10_000, 500); // 95% hook share
    assert.equal(s.hookShareBps, 9500);
    assert.equal(s.hook0, 950_000n);
    assert.equal(s.lp0, 50_000n);
    // Exact-sum invariant regardless of rounding.
    assert.equal(s.lp0 + s.hook0, a0);
    assert.equal(s.lp1 + s.hook1, a1);
  });

  it("attributes everything to LP for a plain (no-hook) pool", () => {
    const s = splitAccruedFees(123n, 456n, 3000, undefined);
    assert.equal(s.hookShareBps, 0);
    assert.equal(s.hook0, 0n);
    assert.equal(s.hook1, 0n);
    assert.equal(s.lp0, 123n);
    assert.equal(s.lp1, 456n);
  });
});
