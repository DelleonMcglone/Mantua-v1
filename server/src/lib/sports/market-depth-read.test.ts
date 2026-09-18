/** Phase 11 — the depth read over a fake seam: live fields only while in progress, metrics and depth only with a market. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readMarketDepth, type DepthDb, type DepthEvent } from "./market-depth-read.ts";
import type { MarketMetrics } from "./market-metrics.ts";

const NOW = 1_789_500_000;
const L = String(Math.round(Math.sqrt(10_000e6 * 5_000e6)));
const EVENT: DepthEvent = {
  id: "ev1",
  league: "nfl",
  providerEventId: "401547401",
  startsAt: NOW - 3600,
  status: "in_progress",
  homeScore: 10,
  awayScore: 14,
  home: { teamId: "t-lv", key: "nfl:LV", abbreviation: "LV" },
  away: { teamId: "t-kc", key: "nfl:KC", abbreviation: "KC" },
};

function metrics(): MarketMetrics {
  return {
    marketId: "0x" + "12".repeat(32),
    state: "OPEN",
    chainId: 8453,
    outcomeIndex: 0,
    event: {
      providerEventId: "401547401",
      homeTeam: "LV",
      awayTeam: "KC",
      status: "in_progress",
      label: "LV",
    },
    price: {
      currentYesProbability: 0.42,
      source: "pool",
      capturedAt: NOW - 30,
      change24hBps: -300,
      history: [],
      latestLiquidityRaw: L,
    },
    volume: { totalUsdc: 12_000, usdc24h: 900, buyCount: 30, sellCount: 12 },
    activity: { fillCount: 42, fillCount24h: 12, uniqueTraders: 9, lastTradeAt: NOW - 120 },
    openInterest: {
      yesTokensOpen: 1500,
      noTokensOpen: 2200,
      openPositionCount: 11,
      yesSupply: 4000,
    },
    concentration: null,
    liquidity: { poolLiquidity: L, poolId: "0xpool" },
    timing: { startsAt: NOW - 3600, secondsToKickoff: 0, frozenAt: null, resolvedAt: null },
    computedAt: NOW,
  };
}

function fakeDb(over: Partial<DepthDb> = {}): DepthDb {
  return {
    findEvent: () => Promise.resolve(EVENT),
    moneylineMarkets: () =>
      Promise.resolve([
        { marketId: "0x" + "12".repeat(32), outcomeIndex: 0, frozenAt: null, resolvedAt: null },
        { marketId: "0x" + "34".repeat(32), outcomeIndex: 1, frozenAt: null, resolvedAt: null },
      ]),
    metrics: () => Promise.resolve(metrics()),
    latestPlay: () =>
      Promise.resolve({
        period: 2,
        clock: "07:12",
        description: "Mahomes pass complete for 12 yards",
        teamKey: "nfl:KC",
        possessionAfter: "nfl:LV",
        at: NOW - 60,
      }),
    periodStarts: () =>
      Promise.resolve([
        { period: 1, at: NOW - 3500 },
        { period: 2, at: NOW - 1200 },
      ]),
    injuries: () =>
      Promise.resolve([
        {
          at: NOW - 86_400,
          teamId: "t-kc",
          player: "Chris Jones",
          status: "questionable",
          description: "calf",
        },
      ]),
    ...over,
  };
}

void describe("readMarketDepth", () => {
  void it("returns null for an unknown event", async () => {
    const dbx = fakeDb({ findEvent: () => Promise.resolve(null) });
    assert.equal(await readMarketDepth(dbx, "x", NOW), null);
  });

  void it("assembles metrics, depth, live game, and annotations for a live market", async () => {
    const read = await readMarketDepth(fakeDb(), "401547401", NOW);
    assert.ok(read);
    assert.equal(read.hasMarkets, true);
    const m = read.metrics;
    assert.ok(m);
    assert.equal(m.priceBps, 4200);
    assert.equal(m.openInterest.contractsOpen, 3700);
    assert.equal(m.volume.usdc24h, 900);
    const depth = read.depth;
    assert.ok(depth);
    assert.equal(depth.priceBps, 4200);
    assert.ok(depth.levels.length > 0);
    assert.deepEqual(read.game, {
      status: "in_progress",
      homeScore: 10,
      awayScore: 14,
      period: 2,
      clock: "07:12",
      possession: "nfl:LV",
      lastPlay: "Mahomes pass complete for 12 yards",
      asOf: NOW - 60,
    });
    assert.deepEqual(
      read.annotations.map((a) => `${a.kind}:${a.label}`),
      ["injury:KC: Chris Jones questionable", "kickoff:Kickoff", "period:Q2"],
    );
  });

  void it("has no live fields, metrics, or depth for a scheduled game without markets", async () => {
    const read = await readMarketDepth(
      fakeDb({
        findEvent: () => Promise.resolve({ ...EVENT, status: "scheduled", startsAt: NOW + 3600 }),
        moneylineMarkets: () => Promise.resolve([]),
        latestPlay: () => Promise.resolve(null),
        periodStarts: () => Promise.resolve([]),
        injuries: () => Promise.resolve([]),
      }),
      "401547401",
      NOW,
    );
    assert.ok(read);
    assert.equal(read.hasMarkets, false);
    assert.equal(read.metrics, null);
    assert.equal(read.depth, null);
    assert.equal(read.game.period, null);
    assert.deepEqual(read.annotations, []);
  });
});
