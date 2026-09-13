import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { basisFromLedger, computeLpEconomics, totalLpEconomics } from "./lp-economics.ts";

/** Phase 9 / PF-002, PF-007 — LP economics are honest about what is unknown. */

const POS = {
  tokenId: "42",
  tokenA: "USDC",
  tokenB: "EURC",
  amountA: "100.5",
  amountB: "80",
  liquidity: "250000",
  hook: null,
  fee: 3000,
};

void describe("computeLpEconomics", () => {
  void it("values the position at live prices, adds accrued fees, and derives P&L from the ledger basis", () => {
    const e = computeLpEconomics(
      POS,
      { a: 1, b: 1.1 },
      { depositedUsd: 180, firstAddAt: "2026-09-01T00:00:00.000Z", adds: 2 },
      2.5,
      1_000_000n,
    );
    assert.equal(e.currentValueUsd, 188.5);
    assert.equal(e.accruedFeesUsd, 2.5);
    assert.equal(e.depositedUsd, 180);
    assert.equal(e.pnlUsd, 11);
    assert.equal(e.pnlPct, 6.11);
    assert.equal(e.liquidityShareBps, 2500);
    assert.equal(e.since, "2026-09-01T00:00:00.000Z");
    assert.equal(e.pair, "USDC/EURC");
  });

  void it("reports null basis, P&L and share when they are unknown — never zero", () => {
    const e = computeLpEconomics(POS, { a: 1, b: 1 }, null, 0, null);
    assert.equal(e.depositedUsd, null);
    assert.equal(e.pnlUsd, null);
    assert.equal(e.pnlPct, null);
    assert.equal(e.liquidityShareBps, null);
    assert.equal(e.currentValueUsd, 180.5);
  });

  void it("totals count positions without a basis separately", () => {
    const withBasis = computeLpEconomics(
      POS,
      { a: 1, b: 1 },
      { depositedUsd: 170, firstAddAt: null, adds: 1 },
      1,
      null,
    );
    const without = computeLpEconomics({ ...POS, tokenId: "43" }, { a: 1, b: 1 }, null, 0.5, null);
    const t = totalLpEconomics([withBasis, without]);
    assert.deepEqual(t, {
      positions: 2,
      currentValueUsd: 361,
      accruedFeesUsd: 1.5,
      depositedUsd: 170,
      pnlUsd: 11.5,
      withoutBasis: 1,
    });
  });
});

void describe("basisFromLedger", () => {
  void it("sums adds per tokenId and keeps the earliest timestamp; rows without a tokenId are skipped", () => {
    const m = basisFromLedger([
      {
        params: { tokenId: "42" },
        usdValue: "100.00",
        createdAt: new Date("2026-09-02T00:00:00Z"),
      },
      { params: { tokenId: "42" }, usdValue: "80.00", createdAt: new Date("2026-09-01T00:00:00Z") },
      { params: { tokenId: "43" }, usdValue: null, createdAt: new Date("2026-09-03T00:00:00Z") },
      {
        params: { poolKeyHash: "0x…" },
        usdValue: "50.00",
        createdAt: new Date("2026-09-03T00:00:00Z"),
      },
    ]);
    assert.deepEqual(m.get("42"), {
      depositedUsd: 180,
      firstAddAt: "2026-09-01T00:00:00.000Z",
      adds: 2,
    });
    assert.deepEqual(m.get("43"), {
      depositedUsd: 0,
      firstAddAt: "2026-09-03T00:00:00.000Z",
      adds: 1,
    });
    assert.equal(m.size, 2);
  });
});
