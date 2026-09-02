import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampProbability,
  priceToProbability,
  probabilityToPrice,
  probabilityToSqrtPriceX96,
  sqrtPriceX96ToProbability,
  formatProbability,
  probabilityToAmericanOdds,
  InvalidProbabilityError,
  MIN_PROBABILITY,
  MAX_PROBABILITY,
} from "./probability.ts";

void describe("clampProbability", () => {
  void it("passes through values inside the tradeable range", () => {
    assert.equal(clampProbability(0.62), 0.62);
  });

  void it("clamps the endpoints, which have no tradeable range", () => {
    assert.equal(clampProbability(0), MIN_PROBABILITY);
    assert.equal(clampProbability(1), MAX_PROBABILITY);
  });

  void it("rejects values outside [0, 1]", () => {
    assert.throws(() => clampProbability(-0.1), InvalidProbabilityError);
    assert.throws(() => clampProbability(1.1), InvalidProbabilityError);
  });

  void it("rejects NaN and infinities rather than propagating them", () => {
    assert.throws(() => clampProbability(Number.NaN), InvalidProbabilityError);
    assert.throws(() => clampProbability(Number.POSITIVE_INFINITY), InvalidProbabilityError);
  });
});

void describe("price ↔ probability", () => {
  void it("round-trips", () => {
    for (const p of [0.05, 0.25, 0.5, 0.62, 0.95]) {
      assert.equal(priceToProbability(probabilityToPrice(p)), p);
    }
  });
});

void describe("sqrtPriceX96 ↔ probability", () => {
  void it("round-trips when YES is token0", () => {
    for (const p of [0.05, 0.25, 0.5, 0.62, 0.95]) {
      const sqrtPrice = probabilityToSqrtPriceX96(p, true);
      const back = sqrtPriceX96ToProbability(sqrtPrice, true);
      assert.ok(Math.abs(back - p) < 1e-9, `expected ~${String(p)}, got ${String(back)}`);
    }
  });

  void it("round-trips when YES is token1", () => {
    for (const p of [0.05, 0.25, 0.5, 0.62, 0.95]) {
      const sqrtPrice = probabilityToSqrtPriceX96(p, false);
      const back = sqrtPriceX96ToProbability(sqrtPrice, false);
      assert.ok(Math.abs(back - p) < 1e-9, `expected ~${String(p)}, got ${String(back)}`);
    }
  });

  void it("orders token0 and token1 inversely — the ordering is not cosmetic", () => {
    // Seeding with the wrong `yesIsToken0` opens the pool at 1 − p, silently.
    // These must not be equal, or that mistake would be undetectable.
    const asToken0 = probabilityToSqrtPriceX96(0.25, true);
    const asToken1 = probabilityToSqrtPriceX96(0.25, false);
    assert.notEqual(asToken0, asToken1);
  });

  void it("is monotonic in probability", () => {
    let previous = 0n;
    for (const p of [0.1, 0.2, 0.3, 0.5, 0.7, 0.9]) {
      const sqrtPrice = probabilityToSqrtPriceX96(p, true);
      assert.ok(sqrtPrice > previous, `expected increasing sqrtPrice at p=${String(p)}`);
      previous = sqrtPrice;
    }
  });

  void it("rejects a non-positive sqrtPrice", () => {
    assert.throws(() => sqrtPriceX96ToProbability(0n, true), InvalidProbabilityError);
    assert.throws(() => sqrtPriceX96ToProbability(-1n, true), InvalidProbabilityError);
  });
});

void describe("display helpers", () => {
  void it("formats a probability as a percentage", () => {
    assert.equal(formatProbability(0.62), "62%");
    assert.equal(formatProbability(0.6234, 1), "62.3%");
  });

  void it("converts to American odds on both sides of even", () => {
    assert.equal(probabilityToAmericanOdds(0.5), "−100");
    assert.equal(probabilityToAmericanOdds(0.8), "−400");
    assert.equal(probabilityToAmericanOdds(0.25), "+300");
  });
});
