/**
 * Task 049 (H-012, H-016) — the TypeScript fee mirror must agree with the
 * Solidity library bit for bit. Both suites read the same vector file, so a
 * change to either side shows up as a failure on the other.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_RATE_PIPS,
  MIN_RATE_PIPS,
  REGULAR_SEASON_FEE_PIPS,
  contractFee,
  effectiveFeePips,
  feeOnInput,
  feeQuoteFromBreakdown,
  feeUsdcValue,
  type FeeBreakdown,
} from "./market-fee.ts";

interface Vectors {
  ratePips: number[];
  probabilityBps: number[];
  feePips: number[];
  contracts: string[];
  contractFee: string[];
  inputFee: { amountIn: string[]; feePips: number[]; fee: string[] };
}

const VECTORS = JSON.parse(
  readFileSync(
    new URL("../../../../contracts/test/hooks/dynamic-market/fee-vectors.json", import.meta.url),
    "utf8",
  ),
) as Vectors;

const breakdown = (over: Partial<FeeBreakdown> = {}): FeeBreakdown => ({
  minRate: MIN_RATE_PIPS,
  liquidityPremium: 0,
  volatilityPremium: 0,
  activityPremium: 0,
  uncertaintyPremium: 0,
  rate: MIN_RATE_PIPS,
  probabilityBps: 5000,
  playoffs: true,
  stale: false,
  ...over,
});

void describe("market-fee mirrors MarketFeeFormula.sol", () => {
  void it("matches every shared vector", () => {
    assert.ok(VECTORS.ratePips.length > 10, "vector file must carry the matrix");
    VECTORS.ratePips.forEach((rate, i) => {
      const p = VECTORS.probabilityBps[i];
      assert.equal(effectiveFeePips(rate, p), VECTORS.feePips[i], `feePips vector ${String(i)}`);
      assert.equal(
        contractFee(BigInt(VECTORS.contracts[i]), rate, p).toString(),
        VECTORS.contractFee[i],
        `contractFee vector ${String(i)}`,
      );
    });
    VECTORS.inputFee.amountIn.forEach((amountIn, i) => {
      assert.equal(
        feeOnInput(BigInt(amountIn), VECTORS.inputFee.feePips[i]).toString(),
        VECTORS.inputFee.fee[i],
        `feeOnInput vector ${String(i)}`,
      );
    });
  });

  void it("carries the D-105 bounds", () => {
    assert.equal(REGULAR_SEASON_FEE_PIPS, 0);
    assert.equal(MIN_RATE_PIPS, 1000);
    assert.equal(MAX_RATE_PIPS, 7000);
    assert.equal(effectiveFeePips(MAX_RATE_PIPS, 0), MAX_RATE_PIPS, "never above the ceiling");
  });

  void it("shapes the per-contract fee to peak at 50/50 and decline to the extremes", () => {
    const at = (p: number) => contractFee(100_000_000n, MAX_RATE_PIPS, p);
    assert.equal(at(5000), 175_000n, "$100 position at 0.70% and 50/50 → $0.175");
    for (const p of [0, 500, 1000, 2500, 7500, 9000, 9500, 10_000]) assert.ok(at(p) <= at(5000));
    assert.equal(at(2500), at(7500), "mirror images pay the same");
    assert.equal(at(0), 0n);
    assert.equal(at(10_000), 0n);
  });

  void it("values a YES-denominated fee at p and a USDC fee at face", () => {
    assert.equal(feeUsdcValue(1_000_000n, true, 2500), 250_000n);
    assert.equal(feeUsdcValue(1_000_000n, false, 2500), 1_000_000n);
    assert.equal(feeUsdcValue(1_000_000n, true, 20_000), 1_000_000n, "clamped to certainty");
  });

  void it("assembles the quote the UI renders — buy at 50/50, $100 in", () => {
    const q = feeQuoteFromBreakdown(3500, breakdown({ rate: MAX_RATE_PIPS }), 100_000_000n, false);
    assert.equal(q.feePips, 3500);
    assert.equal(q.ratePips, 7000);
    assert.equal(q.feeRaw, "350000", "$0.35 on $100 spent");
    assert.equal(q.feeUsdcRaw, "350000");
    assert.equal(q.playoffs, true);
  });

  void it("assembles a sell quote in YES units and values it in USDC", () => {
    const q = feeQuoteFromBreakdown(
      750,
      breakdown({ rate: MIN_RATE_PIPS, probabilityBps: 2500 }),
      400_000_000n,
      true,
    );
    assert.equal(q.feeRaw, "300000", "0.075% of 400 YES = 0.3 YES");
    assert.equal(q.feeUsdcRaw, "75000", "0.3 YES at $0.25");
  });

  void it("is zero in the regular season whatever the input", () => {
    const q = feeQuoteFromBreakdown(
      0,
      breakdown({ minRate: 0, rate: 0, playoffs: false, probabilityBps: 5000 }),
      123_456_789n,
      false,
    );
    assert.equal(q.feeRaw, "0");
    assert.equal(q.feeUsdcRaw, "0");
    assert.equal(q.playoffs, false);
  });
});
