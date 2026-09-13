/**
 * Phase 12 — the depth curve is the constant-product cost to move the
 * price: symmetric at 50¢, monotone in the step, clamped at the edges, and
 * absent when the pool or the price is unknown.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEPTH_STEPS_BPS, depthCurve } from "./market-depth.ts";

// L = 10_000 USDC × 10_000 contracts at 50¢ → √(x·y) with y = 5_000 USDC raw.
// x = 10_000e6 contracts, y = 5_000e6 USDC → L = √(5e19) ≈ 7.07e9.
const L = String(Math.round(Math.sqrt(10_000e6 * 5_000e6)));

void describe("depthCurve", () => {
  void it("returns null without a pool or a price", () => {
    assert.equal(depthCurve(null, 5000), null);
    assert.equal(depthCurve(L, null), null);
    assert.equal(depthCurve("0", 5000), null);
    assert.equal(depthCurve("nope", 5000), null);
  });

  void it("quotes every step on both sides at 50¢, with growing cost", () => {
    const curve = depthCurve(L, 5000);
    assert.ok(curve);
    assert.equal(curve.priceBps, 5000);
    assert.equal(curve.levels.length, DEPTH_STEPS_BPS.length * 2);
    const buys = curve.levels.filter((l) => l.side === "buy");
    const sells = curve.levels.filter((l) => l.side === "sell");
    assert.deepEqual(
      buys.map((l) => l.priceBps),
      [5100, 5200, 5500, 6000, 7000],
    );
    assert.deepEqual(
      sells.map((l) => l.priceBps),
      [4900, 4800, 4500, 4000, 3000],
    );
    for (let i = 1; i < buys.length; i += 1) {
      assert.ok((buys[i]?.usdc ?? 0) > (buys[i - 1]?.usdc ?? 0), "buy cost grows with the step");
      assert.ok((sells[i]?.contracts ?? 0) > (sells[i - 1]?.contracts ?? 0));
    }
    // 2·L·√p = 2 × 7.07e9 × 0.707 / 1e6 = 10_000 USDC of liquidity.
    assert.equal(curve.liquidityUsdc, 10_000);
  });

  void it("matches the closed form for one buy level", () => {
    const curve = depthCurve(L, 5000);
    const first = curve?.levels.find((l) => l.side === "buy" && l.priceBps === 5100);
    assert.ok(first);
    const l = Number(L);
    const usdc = (l * (Math.sqrt(0.51) - Math.sqrt(0.5))) / 1e6;
    const contracts = (l * (1 / Math.sqrt(0.5) - 1 / Math.sqrt(0.51))) / 1e6;
    assert.equal(first.usdc, Math.round(usdc * 100) / 100);
    assert.equal(first.contracts, Math.round(contracts * 100) / 100);
    // Paying ~$50 for ~$99 of contracts near 50¢ is the right order of magnitude.
    assert.ok(first.usdc > 49 && first.usdc < 51);
    assert.ok(first.contracts > 98 && first.contracts < 100);
  });

  void it("clamps at the edges and drops collapsed levels", () => {
    const high = depthCurve(L, 9850);
    assert.ok(high);
    assert.deepEqual(
      high.levels.filter((l) => l.side === "buy").map((l) => l.priceBps),
      [9900],
    );
    assert.equal(high.levels.filter((l) => l.side === "sell").length, 5);
    const low = depthCurve(L, 50);
    assert.ok(low);
    assert.equal(low.priceBps, 100);
    assert.equal(low.levels.filter((l) => l.side === "sell").length, 0);
  });
});
