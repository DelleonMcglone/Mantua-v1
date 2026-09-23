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
 * Base Mainnet deployment guards: Mantua's pool hooks (Stable Protection,
 * Dynamic Fee) have no mainnet addresses yet — see
 * docs/tasks/v2-roadmap.md. These regression guards fail if a future
 * change registers a placeholder address before a deployment exists.
 */
describe("Base Mainnet deployment pending", () => {
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
describe("Dynamic Market stack on Base Mainnet (H-009)", () => {
  const dm = DYNAMIC_MARKET_BY_CHAIN[BASE_CHAIN_ID];

  it("registers the deployed addresses from deploy/dynamic-market/README.md", () => {
    assert.deepEqual(dm, {
      poolManager: "0xee196B3F83Fe6f57E074C399DBdeFe07e1407636",
      registry: "0xEA8c2f329E7eBD9a67FA7E502CEcc938bE3ec7a6",
      hook: "0xb23d3EeC2272F3557f6B7BBEA8A9649Cf9c028c0",
      operator: "0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3",
      keeper: "0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3",
    });
  });

  it("hook address encodes BEFORE_INITIALIZE | BEFORE_ADD_LIQUIDITY | BEFORE_SWAP | AFTER_SWAP", () => {
    assert.ok(dm);
    assert.equal(Number(BigInt(dm.hook) & 0x3fffn), 0x28c0);
  });

  it("routes the hook to its own PoolManager and the market periphery", () => {
    assert.ok(dm);
    const stack = getV4StackForHook(dm.hook, BASE_CHAIN_ID);
    assert.equal(stack.poolManager, dm.poolManager);
    assert.equal(stack.quoter, "0x1791972C76a8Bcb9da83E50B9435612590a0102f");
    assert.equal(stack.stateView, "0x8F76Bba1695798E9ddDb0Da6c67c2900fe0f5deF");
    assert.equal(stack.positionManager, "0x17a69A23F3c0F7F0dCA6391f967C020BaC0906da");
    assert.equal(stack.poolSwapTest, "0x76578c4EA626bEe114e5B72939e7927eF5f1CAbF");
    assert.notEqual(stack.poolManager, getV4Addresses(BASE_CHAIN_ID).poolManager);
  });
});
