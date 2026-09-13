import { strict as assert } from "node:assert";
import { test } from "node:test";
import { depthRows, depthSummary, formatUsd, metricLines, movement } from "./depth-core.ts";
import type { DepthCurve, DepthMetrics } from "./depth-types.ts";

const METRICS: DepthMetrics = {
  priceBps: 4200,
  source: "pool",
  capturedAt: 1,
  change24hBps: -320,
  volume: { totalUsdc: 12_345, usdc24h: 987.5, buyCount: 30, sellCount: 12 },
  activity: { fillCount: 42, fillCount24h: 12, uniqueTraders: 9, lastTradeAt: 1 },
  openInterest: { contractsOpen: 3700, positions: 11, supply: 4000 },
  timing: { startsAt: 0, secondsToKickoff: 0, frozenAt: null, resolvedAt: null },
};

const CURVE: DepthCurve = {
  liquidityUsdc: 10_000,
  priceBps: 5000,
  levels: [
    { side: "buy", priceBps: 5100, usdc: 50, contracts: 99 },
    { side: "buy", priceBps: 5500, usdc: 260, contracts: 490 },
    { side: "sell", priceBps: 4900, usdc: 50, contracts: 101 },
    { side: "sell", priceBps: 4500, usdc: 260, contracts: 550 },
  ],
};

test("metric lines carry the price with its move, volume, trades, and open interest", () => {
  const lines = metricLines(METRICS);
  assert.deepEqual(
    lines.map((l) => l.id),
    ["price", "volume", "trades", "open-interest"],
  );
  assert.equal(lines[0]?.value, "42¢");
  assert.equal(lines[0]?.hint, "−3.2 pts over 24h");
  assert.equal(lines[1]?.value, "$987.50");
  assert.equal(lines[1]?.hint, "$12,345 all time");
  assert.equal(lines[2]?.value, "12");
  assert.equal(lines[3]?.value, "3,700 contracts");
  assert.deepEqual(metricLines(null), []);
});

test("movement reads as points over 24h, flat near zero, unknown when null", () => {
  assert.equal(movement(250), "+2.5 pts over 24h");
  assert.equal(movement(3), "flat over 24h");
  assert.equal(movement(null), null);
  assert.equal(formatUsd(12.3), "$12.30");
  assert.equal(formatUsd(1200), "$1,200");
});

test("the ladder runs from the deepest sell to the deepest buy with bar shares", () => {
  const rows = depthRows(CURVE);
  assert.deepEqual(
    rows.map((r) => `${r.side}:${r.price}`),
    ["sell:45¢", "sell:49¢", "buy:51¢", "buy:55¢"],
  );
  assert.equal(rows[3]?.share, 1);
  assert.ok((rows[2]?.share ?? 1) < 0.25);
  assert.equal(rows[3]?.usdc, "$260.00");
  assert.deepEqual(depthRows(null), []);
});

test("the summary names the liquidity and the 5¢ move when quoted", () => {
  assert.equal(depthSummary(CURVE), "$10,000 of liquidity · a $260.00 buy moves the price 5¢.");
  assert.equal(depthSummary({ ...CURVE, levels: [] }), "$10,000 of liquidity behind this price.");
  assert.equal(depthSummary(null), null);
});
