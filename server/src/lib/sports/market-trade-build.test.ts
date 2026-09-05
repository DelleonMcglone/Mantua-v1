import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MarketsNotDeployedError,
  assertUsdcCollateral,
  buildMarketTrade,
  marketMinOut,
  marketSwapSqrtPriceLimit,
  marketTradeSpendUsd,
} from "./market-trade-build.ts";
import { MIN_SQRT_PRICE_LIMIT, MAX_SQRT_PRICE_LIMIT } from "../v4-onchain-swap.ts";
import { DYNAMIC_MARKET_BY_CHAIN } from "../v4-contracts.ts";
import { BASE_CHAIN_ID } from "../chains.ts";

describe("marketTradeSpendUsd (C-019 market-trade cap leg)", () => {
  it("prices a buy at its exact USDC amount (no feed involved)", () => {
    assert.equal(marketTradeSpendUsd("buy", 1_000_000n), 1);
    assert.equal(marketTradeSpendUsd("buy", 12_345_678n), 12.345678);
  });

  it("returns null for a sell — exits return USDC and touch no cap", () => {
    assert.equal(marketTradeSpendUsd("sell", 5_000_000n), null);
  });
});

describe("assertUsdcCollateral (C-004 platform-currency guard)", () => {
  const CANONICAL_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

  it("accepts the canonical Base USDC address, case-insensitively", () => {
    assert.doesNotThrow(() => {
      assertUsdcCollateral(8453, CANONICAL_USDC);
    });
    assert.doesNotThrow(() => {
      assertUsdcCollateral(8453, CANONICAL_USDC.toLowerCase() as `0x${string}`);
    });
  });

  it("rejects any other collateral token", () => {
    // EURC on Base — 6dp stablecoin, but not the platform currency.
    assert.throws(
      () => {
        assertUsdcCollateral(8453, "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42");
      },
      /canonical USDC/,
    );
  });
});

// ─── B7-003: in-calldata slippage protection ────────────────────────────────

const Q96 = 1n << 96n;

describe("marketMinOut", () => {
  it("derives amountOut × (1 − slippage)", () => {
    assert.equal(marketMinOut(1_000_000n, 50), 995_000n);
    assert.equal(marketMinOut(1_000_000n, 0), 1_000_000n);
    assert.equal(marketMinOut(1_000_000n, 500), 950_000n);
  });

  it("rejects slippage above the hard cap and negative slippage", () => {
    assert.throws(() => marketMinOut(1_000_000n, 501));
    assert.throws(() => marketMinOut(1_000_000n, -1));
  });
});

describe("marketSwapSqrtPriceLimit (B7-003 — protection in the calldata)", () => {
  /** Zero-impact quote at spot price 1.0 (both tokens 6dp). */
  const flat = { spotSqrtPriceX96: Q96, amountIn: 1_000_000n, amountOut: 1_000_000n };

  it("zeroForOne: bounds strictly below spot at ~sqrt(1 − slippage)", () => {
    const limit = marketSwapSqrtPriceLimit({ ...flat, zeroForOne: true, slippageBps: 50 });
    assert.ok(limit < Q96, "limit must sit below spot for zeroForOne");
    const ratio = Number(limit) / Number(Q96);
    const expected = Math.sqrt(0.995);
    assert.ok(Math.abs(ratio - expected) < 1e-6, `ratio ${String(ratio)} ≉ ${String(expected)}`);
  });

  it("!zeroForOne: bounds strictly above spot at ~sqrt(1 + slippage)", () => {
    const limit = marketSwapSqrtPriceLimit({ ...flat, zeroForOne: false, slippageBps: 50 });
    assert.ok(limit > Q96, "limit must sit above spot for !zeroForOne");
    const ratio = Number(limit) / Number(Q96);
    const expected = Math.sqrt(1.005);
    assert.ok(Math.abs(ratio - expected) < 1e-6, `ratio ${String(ratio)} ≉ ${String(expected)}`);
  });

  it("wider tolerance ⇒ looser bound (monotonic in slippageBps)", () => {
    const tight = marketSwapSqrtPriceLimit({ ...flat, zeroForOne: true, slippageBps: 50 });
    const loose = marketSwapSqrtPriceLimit({ ...flat, zeroForOne: true, slippageBps: 100 });
    assert.ok(loose < tight, "more slippage must move the zeroForOne bound further down");
  });

  it("anchors on the quote's own landing price, so a healthy fill's impact fits inside the bound", () => {
    // Selling with 1% average impact (out = 0.99 × in at spot 1.0): the
    // bound must sit below the zero-impact bound — it made room for the
    // trade's own price movement.
    const withImpact = marketSwapSqrtPriceLimit({
      spotSqrtPriceX96: Q96,
      zeroForOne: true,
      amountIn: 1_000_000n,
      amountOut: 990_000n,
      slippageBps: 50,
    });
    const zeroImpact = marketSwapSqrtPriceLimit({ ...flat, zeroForOne: true, slippageBps: 50 });
    assert.ok(withImpact < zeroImpact);
    // Landing price ≈ 2×0.99 − 1 = 0.98; bound ≈ sqrt(0.98 × 0.995).
    const ratio = Number(withImpact) / Number(Q96);
    const expected = Math.sqrt(0.98 * 0.995);
    assert.ok(Math.abs(ratio - expected) < 1e-6, `ratio ${String(ratio)} ≉ ${String(expected)}`);
  });

  it("zero slippage still keeps the limit strictly on the correct side of spot", () => {
    const down = marketSwapSqrtPriceLimit({ ...flat, zeroForOne: true, slippageBps: 0 });
    const up = marketSwapSqrtPriceLimit({ ...flat, zeroForOne: false, slippageBps: 0 });
    assert.equal(down, Q96 - 1n);
    assert.equal(up, Q96 + 1n);
  });

  it("degenerate quotes (impact beyond recovery) fall back to the direction's extreme", () => {
    const down = marketSwapSqrtPriceLimit({
      spotSqrtPriceX96: Q96,
      zeroForOne: true,
      amountIn: 1_000_000_000n,
      amountOut: 1n, // effectively zero output — projected price ≤ 0
      slippageBps: 50,
    });
    assert.equal(down, MIN_SQRT_PRICE_LIMIT);
    const up = marketSwapSqrtPriceLimit({
      spotSqrtPriceX96: Q96,
      zeroForOne: false,
      amountIn: 1n,
      amountOut: 1_000_000_000n,
      slippageBps: 50,
    });
    assert.equal(up, MAX_SQRT_PRICE_LIMIT);
  });

  it("clamps inside v4's legal sqrt-price range", () => {
    const up = marketSwapSqrtPriceLimit({
      spotSqrtPriceX96: MAX_SQRT_PRICE_LIMIT - 1n,
      zeroForOne: false,
      amountIn: 10n ** 40n, // enormous token1-per-token0 effective price
      amountOut: 1n,
      slippageBps: 500,
    });
    assert.equal(up, MAX_SQRT_PRICE_LIMIT);
  });

  it("rejects out-of-bounds slippage and non-positive inputs", () => {
    assert.throws(() => marketSwapSqrtPriceLimit({ ...flat, zeroForOne: true, slippageBps: 501 }));
    assert.throws(() => marketSwapSqrtPriceLimit({ ...flat, zeroForOne: true, slippageBps: -1 }));
    assert.throws(() =>
      marketSwapSqrtPriceLimit({
        spotSqrtPriceX96: 0n,
        zeroForOne: true,
        amountIn: 1n,
        amountOut: 1n,
        slippageBps: 50,
      }),
    );
    assert.throws(() =>
      marketSwapSqrtPriceLimit({
        spotSqrtPriceX96: Q96,
        zeroForOne: true,
        amountIn: 0n,
        amountOut: 1n,
        slippageBps: 50,
      }),
    );
  });
});

// ─── B7 edge case: graceful gating with no markets deployment ───────────────

describe("buildMarketTrade gating (MARKETS_BY_CHAIN empty)", () => {
  it("throws MarketsNotDeployedError — a typed gated state, not an opaque error", async () => {
    // Precondition: no DM deployment is configured on Base in this repo state.
    assert.equal(DYNAMIC_MARKET_BY_CHAIN[BASE_CHAIN_ID], undefined);
    await assert.rejects(
      buildMarketTrade({
        providerEventId: "401547401",
        outcomeIndex: 0,
        direction: "sell",
        amountRaw: 1_000_000n,
      }),
      (err: unknown) => {
        assert.ok(err instanceof MarketsNotDeployedError);
        assert.match(err.message, /not deployed on chain 8453/);
        return true;
      },
    );
  });
});
