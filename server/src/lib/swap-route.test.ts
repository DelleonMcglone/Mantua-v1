/**
 * B7-005 — the DM-112 routing split.
 *
 * The two failure conditions under test, verbatim from
 * docs/tasks/B7-trading-page.md:
 *
 *  - "A market outcome token routes through the base-pair Trading API
 *    path" — resolveSwapRoute must classify any pair carrying a
 *    non-registry (outcome) token as `market-pool`, never
 *    `universal-router`.
 *  - "A shared quote/calldata builder resolves the wrong v4 stack for a
 *    hooked market pool" — getV4StackForHook must resolve the Dynamic
 *    Market hook to the DM PoolManager + market periphery, never the
 *    canonical stack.
 *
 * DM/periphery config is empty on Base until the deployment lands, so the
 * hook-resolution cases inject a synthetic deployment and remove it again
 * (try/finally) — the graceful-gating case asserts the empty-config
 * behavior first.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BASE_CHAIN_ID } from "./chains.ts";
import { getToken } from "./tokens.ts";
import {
  SwapRouteMismatchError,
  assertSwapRoute,
  isMarketPoolHook,
  resolveSwapRoute,
} from "./swap-route.ts";
import {
  DYNAMIC_MARKET_BY_CHAIN,
  getV4Addresses,
  getV4StackForHook,
  type DynamicMarketDeployment,
} from "./v4-contracts.ts";
import { MARKETS_PERIPHERY_BY_CHAIN, type MarketsPeriphery } from "./markets-contracts.ts";

const USDC = getToken("USDC", BASE_CHAIN_ID).address;
const EURC = getToken("EURC", BASE_CHAIN_ID).address;
const CBBTC = getToken("cbBTC", BASE_CHAIN_ID).address;
/** A market-minted YES token — deliberately NOT in the registry. */
const YES_TOKEN = "0x1111111111111111111111111111111111111111" as const;
const OTHER_OUTCOME = "0x2222222222222222222222222222222222222222" as const;

const DM_HOOK = "0xAbCd000000000000000000000000000000000AC0" as const;

const SYNTHETIC_DM: DynamicMarketDeployment = {
  poolManager: "0x3333333333333333333333333333333333333333",
  registry: "0x4444444444444444444444444444444444444444",
  hook: DM_HOOK,
  operator: "0x5555555555555555555555555555555555555555",
  keeper: "0x6666666666666666666666666666666666666666",
};

const SYNTHETIC_PERIPHERY: MarketsPeriphery = {
  poolSwapTest: "0x7777777777777777777777777777777777777777",
  poolModifyLiquidityTest: "0x8888888888888888888888888888888888888888",
  stateView: "0x9999999999999999999999999999999999999999",
  quoter: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  positionDescriptor: null,
  positionManager: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

function withSyntheticDm(run: () => void): void {
  DYNAMIC_MARKET_BY_CHAIN[BASE_CHAIN_ID] = SYNTHETIC_DM;
  MARKETS_PERIPHERY_BY_CHAIN[BASE_CHAIN_ID] = SYNTHETIC_PERIPHERY;
  try {
    run();
  } finally {
    Reflect.deleteProperty(DYNAMIC_MARKET_BY_CHAIN, BASE_CHAIN_ID);
    Reflect.deleteProperty(MARKETS_PERIPHERY_BY_CHAIN, BASE_CHAIN_ID);
  }
}

describe("resolveSwapRoute (DM-112 split)", () => {
  it("routes every registry base pair through the universal-router path", () => {
    const pairs: [`0x${string}`, `0x${string}`][] = [
      [USDC, EURC],
      [EURC, USDC],
      [USDC, CBBTC],
      [CBBTC, USDC],
      [EURC, CBBTC],
      [CBBTC, EURC],
    ];
    for (const [tin, tout] of pairs) {
      assert.equal(resolveSwapRoute(tin, tout, BASE_CHAIN_ID), "universal-router");
    }
  });

  it("registry lookup is case-insensitive (checksummed vs lowercase)", () => {
    assert.equal(
      resolveSwapRoute(
        USDC.toLowerCase() as `0x${string}`,
        EURC.toUpperCase().replace("0X", "0x") as `0x${string}`,
        BASE_CHAIN_ID,
      ),
      "universal-router",
    );
  });

  it("NEVER routes an outcome token through the base-pair path (B7 failure condition)", () => {
    // Outcome token on either side, against every base token and against
    // another outcome token: always market-pool.
    for (const base of [USDC, EURC, CBBTC]) {
      assert.equal(resolveSwapRoute(YES_TOKEN, base, BASE_CHAIN_ID), "market-pool");
      assert.equal(resolveSwapRoute(base, YES_TOKEN, BASE_CHAIN_ID), "market-pool");
    }
    assert.equal(resolveSwapRoute(YES_TOKEN, OTHER_OUTCOME, BASE_CHAIN_ID), "market-pool");
  });

  it("assertSwapRoute throws SwapRouteMismatchError on a cross-over, passes on a match", () => {
    assert.doesNotThrow(() => {
      assertSwapRoute("market-pool", YES_TOKEN, USDC, BASE_CHAIN_ID);
    });
    assert.doesNotThrow(() => {
      assertSwapRoute("universal-router", USDC, EURC, BASE_CHAIN_ID);
    });
    assert.throws(
      () => {
        assertSwapRoute("universal-router", YES_TOKEN, USDC, BASE_CHAIN_ID);
      },
      SwapRouteMismatchError,
    );
    assert.throws(
      () => {
        assertSwapRoute("market-pool", USDC, EURC, BASE_CHAIN_ID);
      },
      SwapRouteMismatchError,
    );
  });
});

describe("isMarketPoolHook", () => {
  it("is false for everything while the DM deployment is absent (graceful gating)", () => {
    assert.equal(DYNAMIC_MARKET_BY_CHAIN[BASE_CHAIN_ID], undefined);
    assert.equal(isMarketPoolHook(DM_HOOK, BASE_CHAIN_ID), false);
    assert.equal(
      isMarketPoolHook("0x0000000000000000000000000000000000000000", BASE_CHAIN_ID),
      false,
    );
  });

  it("recognizes the DM hook (case-insensitively) once deployed, and nothing else", () => {
    withSyntheticDm(() => {
      assert.equal(isMarketPoolHook(DM_HOOK, BASE_CHAIN_ID), true);
      assert.equal(isMarketPoolHook(DM_HOOK.toLowerCase(), BASE_CHAIN_ID), true);
      assert.equal(
        isMarketPoolHook("0x0000000000000000000000000000000000000000", BASE_CHAIN_ID),
        false,
      );
      assert.equal(isMarketPoolHook(YES_TOKEN, BASE_CHAIN_ID), false);
    });
  });
});

describe("getV4StackForHook resolves the DM hook to its own stack (B7-005 failure condition)", () => {
  it("DM hook → DM PoolManager + market periphery, never the canonical stack", () => {
    withSyntheticDm(() => {
      const stack = getV4StackForHook(DM_HOOK, BASE_CHAIN_ID);
      assert.equal(stack.poolManager, SYNTHETIC_DM.poolManager);
      assert.equal(stack.quoter, SYNTHETIC_PERIPHERY.quoter);
      assert.equal(stack.stateView, SYNTHETIC_PERIPHERY.stateView);
      assert.equal(stack.poolSwapTest, SYNTHETIC_PERIPHERY.poolSwapTest);
      assert.equal(stack.positionManager, SYNTHETIC_PERIPHERY.positionManager);

      const canonical = getV4Addresses(BASE_CHAIN_ID);
      assert.notEqual(stack.poolManager, canonical.poolManager);
      assert.notEqual(stack.quoter, canonical.quoter);
      assert.notEqual(stack.stateView, canonical.stateView);
    });
  });

  it("the case-flipped DM hook address still resolves the DM stack", () => {
    withSyntheticDm(() => {
      const stack = getV4StackForHook(DM_HOOK.toLowerCase(), BASE_CHAIN_ID);
      assert.equal(stack.poolManager, SYNTHETIC_DM.poolManager);
    });
  });

  it("the zero (no-hook) address resolves the canonical stack even with DM deployed", () => {
    withSyntheticDm(() => {
      const stack = getV4StackForHook("0x0000000000000000000000000000000000000000", BASE_CHAIN_ID);
      assert.deepEqual(stack, getV4Addresses(BASE_CHAIN_ID));
    });
  });
});
