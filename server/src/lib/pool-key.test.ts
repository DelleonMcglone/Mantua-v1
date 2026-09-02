/**
 * `buildPoolKey` unit tests. Guards three invariants that have been the
 * source of multiple production bugs:
 *
 * 1. Token sorting (currency0 < currency1) — v4 requires this.
 * 2. `tickSpacing` derives from the user's static fee tier.
 * 3. `effectivePoolFee` is applied when `hookName` is passed, so hooks
 *    that require dynamic fees (Stable Protection / Dynamic Fee) get
 *    `key.fee = DYNAMIC_FEE_FLAG` while the static tier still drives
 *    `tickSpacing`.
 *
 * Base Mainnet token set: USDC / EURC / cbBTC (no native token).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPoolKey } from "./pool-key.ts";
import { ZERO_ADDRESS } from "./tokens.ts";
import { DYNAMIC_FEE_FLAG } from "./v4-contracts.ts";

const HOOK = "0x1111111111111111111111111111111111111111" as const;

describe("buildPoolKey: token sorting", () => {
  it("sorts USDC/EURC into canonical order regardless of arg order", () => {
    const a = buildPoolKey("USDC", "EURC", 100);
    const b = buildPoolKey("EURC", "USDC", 100);
    assert.equal(a.key.currency0, b.key.currency0);
    assert.equal(a.key.currency1, b.key.currency1);
    assert.equal(a.flipped !== b.flipped, true);
    assert.ok(a.key.currency0 < a.key.currency1, "currency0 must sort before currency1");
  });

  it("sorts USDC/cbBTC canonically", () => {
    const r = buildPoolKey("USDC", "cbBTC", 500);
    assert.ok(r.key.currency0 < r.key.currency1, "currency0 must sort before currency1");
  });

  it("throws when both tokens are identical", () => {
    assert.throws(() => buildPoolKey("USDC", "USDC", 100));
  });

  it("returns lowercase addresses (case-insensitive sort invariant)", () => {
    const r = buildPoolKey("USDC", "EURC", 100);
    assert.equal(r.key.currency0, r.key.currency0.toLowerCase());
    assert.equal(r.key.currency1, r.key.currency1.toLowerCase());
  });
});

describe("buildPoolKey: tick spacing from static fee tier", () => {
  it("0.01% (100) → tickSpacing 1", () => {
    assert.equal(buildPoolKey("USDC", "EURC", 100).key.tickSpacing, 1);
  });
  it("0.05% (500) → tickSpacing 10", () => {
    assert.equal(buildPoolKey("USDC", "cbBTC", 500).key.tickSpacing, 10);
  });
  it("0.30% (3000) → tickSpacing 60", () => {
    assert.equal(buildPoolKey("USDC", "cbBTC", 3000).key.tickSpacing, 60);
  });
  it("1.00% (10000) → tickSpacing 200", () => {
    assert.equal(buildPoolKey("USDC", "cbBTC", 10000).key.tickSpacing, 200);
  });
});

describe("buildPoolKey: hook-aware effective fee", () => {
  it("no hook name → key.fee equals static fee", () => {
    const r = buildPoolKey("USDC", "EURC", 100, ZERO_ADDRESS, null);
    assert.equal(r.key.fee, 100);
  });

  it("stable-protection → key.fee == DYNAMIC_FEE_FLAG, tickSpacing from static tier", () => {
    const r = buildPoolKey("USDC", "EURC", 100, HOOK, "stable-protection");
    assert.equal(r.key.fee, DYNAMIC_FEE_FLAG);
    assert.equal(r.key.tickSpacing, 1);
  });

  it("dynamic-fee → key.fee == DYNAMIC_FEE_FLAG", () => {
    const r = buildPoolKey("USDC", "cbBTC", 500, HOOK, "dynamic-fee");
    assert.equal(r.key.fee, DYNAMIC_FEE_FLAG);
    assert.equal(r.key.tickSpacing, 10);
  });

  it("no-hook pool → keeps the static fee (no dynamic-fee requirement)", () => {
    const r = buildPoolKey("USDC", "EURC", 100, HOOK, null);
    assert.equal(r.key.fee, 100);
  });

  it("hook address is encoded into key.hooks verbatim", () => {
    const r = buildPoolKey("USDC", "EURC", 100, HOOK, "stable-protection");
    assert.equal(r.key.hooks, HOOK);
  });
});
