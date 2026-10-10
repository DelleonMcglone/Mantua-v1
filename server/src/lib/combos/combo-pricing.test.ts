import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fairProbabilityBps,
  oddsMultiplier,
  plannedFeePips,
  priceCombo,
  separateTicketsFeeRaw,
} from "./combo-pricing.ts";

/** Task 072 / CB-003, CB-004 — the pricing engine's arithmetic. */

const legs = [
  { marketId: "0xa", priceBps: 5_000 },
  { marketId: "0xb", priceBps: 6_000 },
  { marketId: "0xc", priceBps: 5_000 },
];

void describe("fair probability and odds", () => {
  void it("multiplies the legs and floors at the probability floor", () => {
    assert.equal(fairProbabilityBps(legs), 1_500);
    assert.equal(fairProbabilityBps([{ priceBps: 1 }, { priceBps: 1 }]), 1);
    assert.equal(fairProbabilityBps([{ priceBps: 10_000 }, { priceBps: 10_000 }]), 9_999);
  });

  void it("turns a price into decimal odds", () => {
    assert.equal(oddsMultiplier(1_500), 6.67);
    assert.equal(oddsMultiplier(5_000), 2);
    assert.equal(oddsMultiplier(0), 0);
  });

  void it("charges the hook's floor rate at the opening price in every season (task 076)", () => {
    // rate × (1 − p): 1000 × 0.85 = 850 pips
    assert.equal(plannedFeePips(1_500), 850);
    assert.equal(plannedFeePips(10_000), 0, "zero only at certainty");
  });
});

void describe("priceCombo", () => {
  void it("planned: shares = (stake − fee) / fair, payout at par, fee taken from the stake first", () => {
    const p = priceCombo({ stakeRaw: 10_000_000n, legs, pool: null });
    assert.equal(p.source, "planned");
    assert.equal(p.fairProbabilityBps, 1_500);
    assert.equal(p.openingProbability, 0.15);
    assert.equal(p.feePips, 850);
    assert.equal(p.feeUsdcRaw, 8_500n);
    assert.equal(p.sharesRaw, ((10_000_000n - 8_500n) * 10_000n) / 1_500n);
    assert.equal(p.potentialPayoutRaw, p.sharesRaw);
    assert.ok(p.premiumBps > 0, "the fee shows as a premium over fair");
    assert.deepEqual(
      p.legs.map((l) => l.oddsMultiplier),
      [2, 1.67, 2],
    );
  });

  void it("planned: the odds follow the effective price net of the fee", () => {
    const p = priceCombo({ stakeRaw: 10_000_000n, legs, pool: null });
    assert.equal(p.effectivePriceBps, Number((10_000_000n * 10_000n) / p.sharesRaw));
    assert.equal(p.combinedOdds, oddsMultiplier(p.effectivePriceBps));
  });

  void it("pool: the pool's own quote sets the price; premium is pool over fair", () => {
    const p = priceCombo({
      stakeRaw: 10_000_000n,
      legs,
      pool: { amountOut: 50_000_000n, feeUsdcRaw: 12_345n, feePips: 700 },
    });
    assert.equal(p.source, "pool");
    assert.equal(p.effectivePriceBps, 2_000);
    assert.equal(p.combinedOdds, 5);
    assert.equal(p.premiumBps, 500);
    assert.equal(p.feeUsdcRaw, 12_345n);
    assert.equal(p.potentialPayoutRaw, 50_000_000n);
  });

  void it("sums the legs' own fees for the separate-tickets comparison", () => {
    assert.equal(separateTicketsFeeRaw([1n, 2n, 3n]), 6n);
    assert.equal(separateTicketsFeeRaw([]), 0n);
  });
});
