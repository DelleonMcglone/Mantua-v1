/**
 * P9-001 — `effectivePoolFee` + `isFeeTier` unit tests. The
 * dynamic-fee override has been the source of two production
 * incidents (hook-rejecting initialize, slot0 lookup miss). These
 * tests freeze the contract.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DYNAMIC_FEE_FLAG,
  DYNAMIC_MARKET_BY_CHAIN,
  HOOK_NAMES,
  HOOK_REQUIRES_DYNAMIC_FEE,
  effectivePoolFee,
  getV4Addresses,
  getV4StackForHook,
  isFeeTier,
} from "./v4-contracts.ts";
import { BASE_CHAIN_ID } from "./chains.ts";

const ZERO = "0x0000000000000000000000000000000000000000";

describe("getV4StackForHook — stack routing", () => {
  it("no-hook (zero address) → the canonical Base stack", () => {
    const s = getV4StackForHook(ZERO);
    assert.equal(s.poolManager, "0x498581fF718922c3f8e6A244956aF099B2652b2b");
    assert.equal(s.positionManager, "0x7C5f5A4bBd8fD63184577525326123B519429bDc");
  });

  it("unrecognized hook → falls back to the canonical stack", () => {
    const s = getV4StackForHook("0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead");
    assert.equal(s.poolManager, "0x498581fF718922c3f8e6A244956aF099B2652b2b");
  });

  it("no test router ships in the canonical mainnet deployment", () => {
    assert.equal(getV4Addresses(BASE_CHAIN_ID).poolSwapTest, null);
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
 * Base Mainnet deployment guards: Mantua's own contracts (hooks, Dynamic
 * Market stack) have no mainnet addresses yet — see
 * docs/tasks/v2-roadmap.md. These regression guards fail if a future
 * change registers a placeholder address before a deployment exists.
 */
describe("Base Mainnet deployment pending", () => {
  it("still ships exactly the two live hooks", () => {
    assert.deepEqual([...HOOK_NAMES], ["stable-protection", "dynamic-fee"]);
  });

  it("has no Dynamic Market stack registered until it is deployed", () => {
    // Registering a placeholder would let getV4StackForHook route live pool
    // operations at a stack that is not there — worse than the lookup
    // simply not matching. An env-driven or deployed entry lifts this.
    assert.equal(DYNAMIC_MARKET_BY_CHAIN[BASE_CHAIN_ID], undefined);
  });
});
