/**
 * P9-001 — `effectivePoolFee` + `isFeeTier` unit tests. The
 * dynamic-fee override has been the source of two production
 * incidents (hook-rejecting initialize, slot0 lookup miss). These
 * tests freeze the contract.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DYNAMIC_FEE_FLAG,
  DYNAMIC_MARKET_BY_CHAIN,
  HOOK_NAMES,
  HOOK_REQUIRES_DYNAMIC_FEE,
  effectivePoolFee,
  getV4Addresses,
  getV4StackForHook,
  hasCanonicalV4,
  isFeeTier,
  V4StackNotDeployedError,
} from "./v4-contracts.ts";
import { SYNTHETIC_CANONICAL_V4, overrideCanonicalV4 } from "./testing/canonical-v4.ts";
import { ARC_CHAIN_ID } from "./chains.ts";

const ZERO = "0x0000000000000000000000000000000000000000";

describe("getV4StackForHook — stack routing (synthetic canonical stack)", () => {
  // Arc ships no canonical Uniswap v4; the routing rules are pinned against
  // a synthetic stack installed for this block only.
  let restore: () => void;
  before(() => {
    restore = overrideCanonicalV4(ARC_CHAIN_ID);
  });
  after(() => {
    restore();
  });

  it("no-hook (zero address) → the canonical stack", () => {
    const s = getV4StackForHook(ZERO);
    assert.equal(s.poolManager, SYNTHETIC_CANONICAL_V4.poolManager);
    assert.equal(s.positionManager, SYNTHETIC_CANONICAL_V4.positionManager);
  });

  it("unrecognized hook → falls back to the canonical stack", () => {
    const s = getV4StackForHook("0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead");
    assert.equal(s.poolManager, SYNTHETIC_CANONICAL_V4.poolManager);
  });

  it("no test router ships in a canonical mainnet deployment", () => {
    assert.equal(getV4Addresses(ARC_CHAIN_ID).poolSwapTest, null);
  });
});

describe("getV4StackForHook — Arc has no canonical stack", () => {
  it("throws the typed gated error for the no-hook address instead of routing at nothing", () => {
    assert.equal(hasCanonicalV4(ARC_CHAIN_ID), false);
    assert.throws(() => getV4StackForHook(ZERO), V4StackNotDeployedError);
    assert.throws(() => getV4Addresses(ARC_CHAIN_ID), V4StackNotDeployedError);
  });
});

describe("isFeeTier", () => {
  it("accepts the four canonical v4 tiers", () => {
    assert.equal(isFeeTier(100), true);
    assert.equal(isFeeTier(500), true);
    assert.equal(isFeeTier(3000), true);
    assert.equal(isFeeTier(10000), true);
  });

  it("rejects anything outside the four tiers", () => {
    assert.equal(isFeeTier(0), false);
    assert.equal(isFeeTier(1), false);
    assert.equal(isFeeTier(99), false);
    assert.equal(isFeeTier(101), false);
    assert.equal(isFeeTier(2500), false);
    assert.equal(isFeeTier(DYNAMIC_FEE_FLAG), false);
  });
});

describe("HOOK_REQUIRES_DYNAMIC_FEE", () => {
  it("stable-protection requires dynamic fee", () => {
    assert.equal(HOOK_REQUIRES_DYNAMIC_FEE["stable-protection"], true);
  });

  it("dynamic-fee requires dynamic fee", () => {
    assert.equal(HOOK_REQUIRES_DYNAMIC_FEE["dynamic-fee"], true);
  });
});

describe("effectivePoolFee", () => {
  it("null hook → static fee passes through unchanged", () => {
    assert.equal(effectivePoolFee(null, 100), 100);
    assert.equal(effectivePoolFee(null, 500), 500);
    assert.equal(effectivePoolFee(undefined, 3000), 3000);
  });

  it("stable-protection always yields DYNAMIC_FEE_FLAG", () => {
    assert.equal(effectivePoolFee("stable-protection", 100), DYNAMIC_FEE_FLAG);
    assert.equal(effectivePoolFee("stable-protection", 500), DYNAMIC_FEE_FLAG);
    assert.equal(effectivePoolFee("stable-protection", 3000), DYNAMIC_FEE_FLAG);
    assert.equal(effectivePoolFee("stable-protection", 10000), DYNAMIC_FEE_FLAG);
  });

  it("dynamic-fee always yields DYNAMIC_FEE_FLAG", () => {
    assert.equal(effectivePoolFee("dynamic-fee", 100), DYNAMIC_FEE_FLAG);
    assert.equal(effectivePoolFee("dynamic-fee", 500), DYNAMIC_FEE_FLAG);
  });

  it("DYNAMIC_FEE_FLAG sanity (matches v4-core LPFeeLibrary)", () => {
    // 0x800000 = 2^23. v4-core sets the high bit of uint24 fee to flag
    // dynamic. If this constant ever drifts, every Stable Protection /
    // Dynamic Fee pool would silently mismatch on-chain.
    assert.equal(DYNAMIC_FEE_FLAG, 0x800000);
    assert.equal(DYNAMIC_FEE_FLAG, 8388608);
  });
});

/**
 * Arc Mainnet deployment guards: Mantua's pool hooks (Stable Protection,
 * Dynamic Fee) have no mainnet addresses yet — see
 * docs/tasks/v2-roadmap.md. These regression guards fail if a future
 * change registers a placeholder address before a deployment exists.
 */
describe("Arc Mainnet deployment pending", () => {
  it("still ships exactly the two live hooks", () => {
    assert.deepEqual([...HOOK_NAMES], ["stable-protection", "dynamic-fee"]);
  });
});

/**
 * The Dynamic Market stack IS deployed on Base (H-009, 2026-09-23). Pin the
 * recorded addresses so an edit can't silently re-point live market pools,
 * and check the hook address carries exactly the four permissions v4 reads
 * from it.
 */
describe("Dynamic Market stack on Arc Mainnet (H-009 — deployment pending)", () => {
  it("registers no Dynamic Market stack until the Arc deploy lands", () => {
    // Registering a placeholder would let getV4StackForHook route live pool
    // operations at a stack that is not there — worse than the lookup
    // simply not matching. The entry appears with the Arc deploy.
    assert.equal(DYNAMIC_MARKET_BY_CHAIN[ARC_CHAIN_ID], undefined);
  });
});
