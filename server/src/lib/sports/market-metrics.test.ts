/**
 * 038 / S-010 — the pure metric aggregations over fixture rows.
 *
 * No DB, no RPC: the module's on-chain and BaseScan inputs already fail
 * to null on their own, so what needs proving here is the arithmetic —
 * fill volume windows, price-change derivation and fallbacks, open
 * interest filtering — and the no-data behavior (nulls, empty history,
 * zero volume; never invented numbers).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { aggregateFills, derivePriceMetrics, deriveOpenInterest, secondsToKickoff } = await import(
  "./market-metrics.ts"
);
type FillRow = import("./market-metrics.ts").FillRow;
type PriceRow = import("./market-metrics.ts").PriceRow;
type PositionRow = import("./market-metrics.ts").PositionRow;

const NOW = 1_800_000_000; // unix seconds
const HOUR = 3_600;

function fill(hoursAgo: number, overrides: Partial<FillRow> = {}): FillRow {
  return {
    address: "0x00000000000000000000000000000000000000aa",
    direction: "buy",
    tokensRaw: "2000000",
    usdcRaw: "1000000", // 1 USDC
    createdAt: new Date((NOW - hoursAgo * HOUR) * 1000),
    ...overrides,
  };
}

function price(hoursAgo: number, p: string, overrides: Partial<PriceRow> = {}): PriceRow {
  return {
    impliedProbability: p,
    source: "pool",
    liquidityRaw: null,
    capturedAt: new Date((NOW - hoursAgo * HOUR) * 1000),
    ...overrides,
  };
}

void describe("aggregateFills", () => {
  void it("splits total vs 24h volume and counts directions", () => {
    const fills = [
      fill(1), // 1 USDC buy, inside 24h
      fill(2, { direction: "sell", usdcRaw: "2500000" }), // 2.5 USDC sell, inside
      fill(48, { usdcRaw: "4000000" }), // 4 USDC buy, outside 24h
    ];
    const { volume, activity } = aggregateFills(fills, NOW);
    assert.equal(volume.totalUsdc, 7.5);
    assert.equal(volume.usdc24h, 3.5);
    assert.equal(volume.buyCount, 2);
    assert.equal(volume.sellCount, 1);
    assert.equal(activity.fillCount, 3);
    assert.equal(activity.fillCount24h, 2);
    assert.equal(activity.lastTradeAt, NOW - HOUR);
  });

  void it("counts unique traders case-insensitively", () => {
    const fills = [
      fill(1, { address: "0x00000000000000000000000000000000000000AA" }),
      fill(2, { address: "0x00000000000000000000000000000000000000aa" }),
      fill(3, { address: "0x00000000000000000000000000000000000000bb" }),
    ];
    assert.equal(aggregateFills(fills, NOW).activity.uniqueTraders, 2);
  });

  void it("skips malformed raw amounts instead of poisoning the totals", () => {
    const fills = [fill(1), fill(2, { usdcRaw: "not-a-number" })];
    const { volume, activity } = aggregateFills(fills, NOW);
    assert.equal(volume.totalUsdc, 1);
    assert.equal(activity.fillCount, 1);
  });

  void it("is all-zeros/null for a never-traded market — not fabricated", () => {
    const { volume, activity } = aggregateFills([], NOW);
    assert.deepEqual(volume, { totalUsdc: 0, usdc24h: 0, buyCount: 0, sellCount: 0 });
    assert.equal(activity.lastTradeAt, null);
    assert.equal(activity.uniqueTraders, 0);
  });
});

void describe("derivePriceMetrics", () => {
  void it("takes the newest capture as current and diffs against the freshest ≥24h-old point", () => {
    const rows = [
      price(1, "0.62000"), // current
      price(20, "0.58000"), // inside 24h — not the comparison point
      price(25, "0.52000"), // freshest ≥24h old → baseline
      price(70, "0.40000"),
    ];
    const m = derivePriceMetrics(rows, "0.50000", NOW);
    assert.equal(m.currentYesProbability, 0.62);
    assert.equal(m.source, "pool");
    assert.equal(m.capturedAt, NOW - HOUR);
    assert.equal(m.change24hBps, 1000); // 0.62 − 0.52 → +1000 bps
    // history is oldest-first
    assert.deepEqual(
      m.history.map((h) => h.p),
      [0.4, 0.52, 0.58, 0.62],
    );
  });

  void it("reports null change with under 24h of history", () => {
    const m = derivePriceMetrics([price(1, "0.62000"), price(2, "0.60000")], null, NOW);
    assert.equal(m.currentYesProbability, 0.62);
    assert.equal(m.change24hBps, null);
  });

  void it("falls back to the opening line when nothing was captured", () => {
    const m = derivePriceMetrics([], "0.55000", NOW);
    assert.equal(m.currentYesProbability, 0.55);
    assert.equal(m.source, "opening");
    assert.equal(m.capturedAt, null);
    assert.deepEqual(m.history, []);
  });

  void it("is honestly null with no captures and no opening line", () => {
    const m = derivePriceMetrics([], null, NOW);
    assert.equal(m.currentYesProbability, null);
    assert.equal(m.source, null);
    assert.equal(m.change24hBps, null);
  });

  void it("surfaces the liquidity recorded with the latest capture", () => {
    const rows = [price(1, "0.62000", { liquidityRaw: "5000000000" }), price(30, "0.50000")];
    assert.equal(derivePriceMetrics(rows, null, NOW).latestLiquidityRaw, "5000000000");
  });
});

void describe("deriveOpenInterest", () => {
  const pos = (side: string, size: string, redeemed = false): PositionRow => ({
    side,
    size,
    redeemedAt: redeemed ? new Date(NOW * 1000) : null,
  });

  void it("sums unredeemed positions per side in human units", () => {
    const oi = deriveOpenInterest(
      [pos("yes", "3000000"), pos("yes", "1000000"), pos("no", "2000000")],
      null,
    );
    assert.equal(oi.yesTokensOpen, 4);
    assert.equal(oi.noTokensOpen, 2);
    assert.equal(oi.openPositionCount, 3);
    assert.equal(oi.yesSupply, null); // pre-deployment: honest null
  });

  void it("excludes redeemed and non-positive rows", () => {
    const oi = deriveOpenInterest(
      [pos("yes", "3000000", true), pos("yes", "0"), pos("no", "junk")],
      12.5,
    );
    assert.equal(oi.yesTokensOpen, 0);
    assert.equal(oi.openPositionCount, 0);
    assert.equal(oi.yesSupply, 12.5);
  });
});

void describe("secondsToKickoff", () => {
  void it("counts down and floors at zero after kickoff", () => {
    assert.equal(secondsToKickoff(NOW + 90, NOW), 90);
    assert.equal(secondsToKickoff(NOW - 90, NOW), 0);
  });
});
