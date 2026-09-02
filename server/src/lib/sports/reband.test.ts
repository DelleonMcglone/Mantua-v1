import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { probabilityToSqrtPriceX96 } from "../probability.ts";
import {
  REBAND_HIGH_TARGET,
  REBAND_LOW_TARGET,
  inputToMovePrice,
  planReband,
  planRebandSwap,
} from "./reband.ts";

const Q96 = 2n ** 96n;

/** Unclamped sqrtPriceX96 for a raw YES price — test-only, because the
 *  production converter clamps to [0.0001, 0.9999] and the whole point
 *  here is prices OUTSIDE the band. */
function sqrtX96(rawYesPrice: number, yesIsToken0: boolean): bigint {
  const ratio = yesIsToken0 ? rawYesPrice : 1 / rawYesPrice;
  return BigInt(Math.floor(Math.sqrt(ratio) * Number(Q96)));
}

/** The seed sizing's target liquidity for the default 10-USDC budget. */
const SEED_LIQUIDITY = 4_500_000n;

void describe("planReband triggers", () => {
  void it("acts only outside the hysteresis band", () => {
    assert.equal(planReband(3.1), "sell-yes"); // the GS@MIN incident price
    assert.equal(planReband(1.021), "sell-yes");
    assert.equal(planReband(1.02), null); // trigger is strict
    assert.equal(planReband(0.99), null);
    assert.equal(planReband(0.5), null);
    assert.equal(planReband(0.01), null); // trigger is strict
    assert.equal(planReband(0.009), "buy-yes");
  });

  void it("degenerate prices are a no-op, never an action", () => {
    assert.equal(planReband(0), null);
    assert.equal(planReband(-1), null);
    assert.equal(planReband(Number.NaN), null);
    assert.equal(planReband(Number.POSITIVE_INFINITY), null);
  });
});

void describe("inputToMovePrice", () => {
  void it("matches the in-range v4 formula moving DOWN (token0 in)", () => {
    const from = sqrtX96(3.1, true);
    const to = sqrtX96(0.99, true);
    const got = inputToMovePrice(SEED_LIQUIDITY, from, to);
    // Δ0 = L·(1/√Pb − 1/√Pa)
    const expected = Number(SEED_LIQUIDITY) * (1 / Math.sqrt(0.99) - 1 / Math.sqrt(3.1));
    assert.ok(Math.abs(Number(got) - expected) < 2, `${String(got)} vs ${String(expected)}`);
  });

  void it("matches the in-range v4 formula moving UP (token1 in)", () => {
    const from = sqrtX96(0.005, true);
    const to = sqrtX96(0.02, true);
    const got = inputToMovePrice(SEED_LIQUIDITY, from, to);
    // Δ1 = L·(√Pb − √Pa)
    const expected = Number(SEED_LIQUIDITY) * (Math.sqrt(0.02) - Math.sqrt(0.005));
    assert.ok(Math.abs(Number(got) - expected) < 2, `${String(got)} vs ${String(expected)}`);
  });

  void it("is zero on no move, no liquidity, or bad prices", () => {
    const p = sqrtX96(0.5, true);
    assert.equal(inputToMovePrice(SEED_LIQUIDITY, p, p), 0n);
    assert.equal(inputToMovePrice(0n, p, p * 2n), 0n);
    assert.equal(inputToMovePrice(SEED_LIQUIDITY, 0n, p), 0n);
    assert.equal(inputToMovePrice(SEED_LIQUIDITY, p, 0n), 0n);
  });

  void it("rounds up, so the estimate never undershoots the exact amount", () => {
    // A move so small the exact input is fractional — must still be ≥ 1.
    const from = sqrtX96(0.5, true);
    const got = inputToMovePrice(1n, from, from - 1n);
    assert.ok(got >= 1n);
  });
});

void describe("planRebandSwap", () => {
  void it("sells YES down to the high target, both token orderings", () => {
    for (const yesIsToken0 of [true, false]) {
      const plan = planRebandSwap({
        sqrtPriceX96: sqrtX96(3.1, yesIsToken0),
        liquidity: SEED_LIQUIDITY,
        yesIsToken0,
      });
      assert.ok(plan, `yesIsToken0=${String(yesIsToken0)}`);
      assert.equal(plan.action, "sell-yes");
      assert.equal(plan.inputIsYes, true);
      // Input is the YES side: token0 exactly when YES is token0.
      assert.equal(plan.zeroForOne, yesIsToken0);
      assert.equal(
        plan.sqrtPriceLimitX96,
        probabilityToSqrtPriceX96(REBAND_HIGH_TARGET, yesIsToken0),
      );
      // The limit must sit on the swap's side of the current price, or the
      // PoolManager rejects it outright.
      const current = sqrtX96(3.1, yesIsToken0);
      assert.ok(
        plan.zeroForOne ? plan.sqrtPriceLimitX96 < current : plan.sqrtPriceLimitX96 > current,
      );
      assert.ok(plan.maxInput > 0n);
    }
  });

  void it("buys YES up to the low target, both token orderings", () => {
    for (const yesIsToken0 of [true, false]) {
      const plan = planRebandSwap({
        sqrtPriceX96: sqrtX96(0.005, yesIsToken0),
        liquidity: SEED_LIQUIDITY,
        yesIsToken0,
      });
      assert.ok(plan, `yesIsToken0=${String(yesIsToken0)}`);
      assert.equal(plan.action, "buy-yes");
      assert.equal(plan.inputIsYes, false);
      // Input is the USDC side: token0 exactly when YES is token1.
      assert.equal(plan.zeroForOne, !yesIsToken0);
      assert.equal(
        plan.sqrtPriceLimitX96,
        probabilityToSqrtPriceX96(REBAND_LOW_TARGET, yesIsToken0),
      );
      const current = sqrtX96(0.005, yesIsToken0);
      assert.ok(
        plan.zeroForOne ? plan.sqrtPriceLimitX96 < current : plan.sqrtPriceLimitX96 > current,
      );
      assert.ok(plan.maxInput > 0n);
    }
  });

  void it("sizes the input with ~25% headroom over the exact walk", () => {
    const plan = planRebandSwap({
      sqrtPriceX96: sqrtX96(3.1, true),
      liquidity: SEED_LIQUIDITY,
      yesIsToken0: true,
    });
    assert.ok(plan);
    const exact = inputToMovePrice(
      SEED_LIQUIDITY,
      sqrtX96(3.1, true),
      probabilityToSqrtPriceX96(REBAND_HIGH_TARGET, true),
    );
    assert.equal(plan.maxInput, (exact * 5n) / 4n + 1n);
    // Sanity of scale: re-banding the incident pool costs ~2.5 USDC, not 50.
    assert.ok(plan.maxInput > 1_000_000n && plan.maxInput < 5_000_000n);
  });

  void it("is null in-band, on an uninitialized pool, and on an empty book", () => {
    assert.equal(
      planRebandSwap({
        sqrtPriceX96: sqrtX96(0.62, true),
        liquidity: SEED_LIQUIDITY,
        yesIsToken0: true,
      }),
      null,
    );
    assert.equal(
      planRebandSwap({ sqrtPriceX96: 0n, liquidity: SEED_LIQUIDITY, yesIsToken0: true }),
      null,
    );
    assert.equal(
      planRebandSwap({ sqrtPriceX96: sqrtX96(3.1, true), liquidity: 0n, yesIsToken0: true }),
      null,
    );
  });
});
