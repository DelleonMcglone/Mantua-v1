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

  void it("charges no fee in the regular season and the hook's minimum rate in the playoffs", () => {
    assert.equal(plannedFeePips(1_500, false), 0);
    // rate × (1 − p): 1000 × 0.85 = 850 pips
    assert.equal(plannedFeePips(1_500, true), 850);
  });
});

void describe("priceCombo", () => {
  void it("planned: shares = (stake − fee) / fair, payout at par, no premium", () => {
    const p = priceCombo({ stakeRaw: 10_000_000n, legs, pool: null, playoffs: false });
    assert.equal(p.source, "planned");
    assert.equal(p.fairProbabilityBps, 1_500);
    assert.equal(p.openingProbability, 0.15);
    assert.equal(p.feeUsdcRaw, 0n);
    assert.equal(p.sharesRaw, 66_666_666n);
    assert.equal(p.potentialPayoutRaw, 66_666_666n);
    assert.equal(p.combinedOdds, 6.67);
    assert.equal(p.premiumBps, 0);
    assert.deepEqual(
      p.legs.map((l) => l.oddsMultiplier),
      [2, 1.67, 2],
    );
  });

  void it("planned in the playoffs takes the hook fee out of the stake first", () => {
    const p = priceCombo({ stakeRaw: 10_000_000n, legs, pool: null, playoffs: true });
    assert.equal(p.feePips, 850);
    assert.equal(p.feeUsdcRaw, 8_500n);
    assert.equal(p.sharesRaw, ((10_000_000n - 8_500n) * 10_000n) / 1_500n);
    assert.ok(p.premiumBps > 0);
  });

  void it("pool: the pool's own quote sets the price; premium is pool over fair", () => {
    const p = priceCombo({
      stakeRaw: 10_000_000n,
      legs,
      pool: { amountOut: 50_000_000n, feeUsdcRaw: 12_345n, feePips: 700 },
      playoffs: false,
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
