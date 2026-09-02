import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE_CHAIN_ID } from "../../lib/chains.ts";
import { tryDeriveAddCtx } from "./defillama-translator.ts";
import { feeForHook, hookForPairAndFee } from "./hook-recommendations.ts";

describe("hookForPairAndFee", () => {
  it("USDC/EURC at 0.01% → stable-protection", () => {
    assert.equal(hookForPairAndFee("USDC", "EURC", 100, BASE_CHAIN_ID), "stable-protection");
    assert.equal(hookForPairAndFee("EURC", "USDC", 100, BASE_CHAIN_ID), "stable-protection");
  });

  it("USDC/EURC at 0.30% → no hook (the reported bug pool)", () => {
    assert.equal(hookForPairAndFee("USDC", "EURC", 3000, BASE_CHAIN_ID), null);
  });

  it("cbBTC pairs at 0.05% → dynamic-fee, other tiers → no hook", () => {
    assert.equal(hookForPairAndFee("USDC", "cbBTC", 500, BASE_CHAIN_ID), "dynamic-fee");
    assert.equal(hookForPairAndFee("EURC", "cbBTC", 500, BASE_CHAIN_ID), "dynamic-fee");
    assert.equal(hookForPairAndFee("USDC", "cbBTC", 3000, BASE_CHAIN_ID), null);
  });

  it("is the inverse of feeForHook for canonical pools", () => {
    assert.equal(feeForHook("stable-protection"), 100);
    assert.equal(feeForHook("dynamic-fee"), 500);
    assert.equal(feeForHook(null), 3000);
  });
});

describe("tryDeriveAddCtx hook recovery", () => {
  it("recovers no-hook for a 0.30% USDC/EURC pool", () => {
    const ctx = tryDeriveAddCtx({ symbol: "USDC-EURC", feeTier: "0.30%" }, BASE_CHAIN_ID);
    assert.deepEqual(ctx, { tokenA: "USDC", tokenB: "EURC", fee: 3000, hook: null });
  });

  it("recovers stable-protection for a 0.01% USDC/EURC pool", () => {
    const ctx = tryDeriveAddCtx({ symbol: "USDC-EURC", feeTier: "0.01%" }, BASE_CHAIN_ID);
    assert.deepEqual(ctx, {
      tokenA: "USDC",
      tokenB: "EURC",
      fee: 100,
      hook: "stable-protection",
    });
  });

  it("returns null for unsupported pairs / fee tiers", () => {
    assert.equal(
      tryDeriveAddCtx({ symbol: "WETH-DAI", feeTier: "0.30%" }, BASE_CHAIN_ID),
      null,
    );
    assert.equal(
      tryDeriveAddCtx({ symbol: "USDC-EURC", feeTier: null }, BASE_CHAIN_ID),
      null,
    );
  });
});
