import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HookPairNotAllowedError,
  assertHookPairAllowed,
  assertHookPairAllowedBySymbol,
  isHookPairAllowed,
  isHookPairAllowedBySymbol,
  listAllowedPairs,
  resolveHookForPool,
} from "./hook-pair-gating.ts";
import { getHookAddress } from "./v4-contracts.ts";
import { TOKENS, ZERO_ADDRESS } from "./tokens.ts";

const USDC = TOKENS.USDC.address;
const EURC = TOKENS.EURC.address;
const CBBTC = TOKENS.cbBTC.address;
const UNKNOWN = "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead";

// Base Mainnet hook → pair matrix:
//  - stable-protection: USDC/EURC
//  - dynamic-fee:       USDC/cbBTC, EURC/cbBTC
describe("isHookPairAllowed — stable-protection (USDC/EURC only)", () => {
  it("accepts USDC/EURC (either order)", () => {
    assert.equal(isHookPairAllowed("stable-protection", USDC, EURC), true);
    assert.equal(isHookPairAllowed("stable-protection", EURC, USDC), true);
    assert.equal(isHookPairAllowedBySymbol("stable-protection", "USDC", "EURC"), true);
  });
  it("rejects USDC/cbBTC", () => {
    assert.equal(isHookPairAllowed("stable-protection", USDC, CBBTC), false);
  });
  it("rejects unknown token addresses", () => {
    assert.equal(isHookPairAllowed("stable-protection", USDC, UNKNOWN), false);
  });
});

describe("isHookPairAllowed — dynamic-fee (volatile pairs)", () => {
  it("accepts USDC/cbBTC and EURC/cbBTC", () => {
    assert.equal(isHookPairAllowed("dynamic-fee", USDC, CBBTC), true);
    assert.equal(isHookPairAllowed("dynamic-fee", EURC, CBBTC), true);
  });
  it("rejects USDC/EURC (stable pair)", () => {
    assert.equal(isHookPairAllowed("dynamic-fee", USDC, EURC), false);
  });
});

describe("listAllowedPairs", () => {
  it("returns [['USDC','EURC']] for stable-protection", () => {
    assert.deepEqual(listAllowedPairs("stable-protection"), [["USDC", "EURC"]]);
  });
  it("returns the volatile pairs for dynamic-fee", () => {
    assert.deepEqual(listAllowedPairs("dynamic-fee"), [
      ["USDC", "cbBTC"],
      ["EURC", "cbBTC"],
    ]);
  });
});

describe("assertHookPairAllowed", () => {
  it("does not throw on an allowed pair", () => {
    assert.doesNotThrow(() => {
      assertHookPairAllowed("stable-protection", USDC, EURC);
    });
    assert.doesNotThrow(() => {
      assertHookPairAllowedBySymbol("dynamic-fee", "USDC", "cbBTC");
    });
  });
  it("throws HookPairNotAllowedError for a disallowed pair", () => {
    assert.throws(() => {
      assertHookPairAllowed("stable-protection", USDC, CBBTC);
    }, HookPairNotAllowedError);
    assert.throws(() => {
      assertHookPairAllowedBySymbol("dynamic-fee", "USDC", "EURC");
    }, HookPairNotAllowedError);
  });
});

describe("resolveHookForPool", () => {
  it("returns ZERO_ADDRESS when no hook is requested", () => {
    assert.equal(resolveHookForPool(null, USDC, EURC), ZERO_ADDRESS);
    assert.equal(resolveHookForPool(undefined, USDC, CBBTC), ZERO_ADDRESS);
  });

  // Hook addresses come from env (STABLE_PROTECTION_HOOK_ADDRESS /
  // DYNAMIC_FEE_HOOK_ADDRESS) — the Base Mainnet deployment is pending, so
  // by default they are null and resolution throws "not deployed"; with an
  // env override the deployed address is returned for an allowed pair.
  it("resolves per the configured hook address (throws when undeployed)", () => {
    const sp = getHookAddress("stable-protection");
    if (sp) {
      assert.equal(resolveHookForPool("stable-protection", USDC, EURC), sp);
    } else {
      assert.throws(() => resolveHookForPool("stable-protection", USDC, EURC), /not deployed/);
    }
  });

  it("still throws when the pair is not allowed for the hook", () => {
    // dynamic-fee does not support the stable USDC/EURC pair (and throws
    // "not deployed" first while the hook address is unset).
    assert.throws(() => resolveHookForPool("dynamic-fee", USDC, EURC));
  });
});
