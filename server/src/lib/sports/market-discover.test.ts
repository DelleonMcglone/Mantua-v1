import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Task 050 (T-018) — the discover composer: public slates + per-market
 * aggregates → one flat, id-free list the Discover page filters. Pure
 * functions; the DB assembly is a thin join covered by the route's
 * contract (see market-discover.ts).
 */
import {
  aggregateDiscoverFills,
  composeDiscoverMarkets,
  poolLiquidityUsdc,
  type DiscoverAggregate,
} from "./market-discover.ts";
import type { PublicSlate } from "./public-slate.ts";

const NOW = 1_800_000_000_000;

const slate = (league: string, over: Partial<PublicSlate> = {}): PublicSlate => ({
  league,
  provider: "canonical",
  delayed: false,
  fetchedAt: NOW - 10_000,
  events: [
    {
      providerEventId: "1",
      startsAt: 1_800_003_600,
      status: "scheduled",
      home: { key: `${league}:KC`, name: "Kansas City Chiefs", abbreviation: "KC" },
      away: { key: `${league}:LV`, name: "Las Vegas Raiders", abbreviation: "LV" },
      homeWinProbabilityBps: 6000,
      liveOdds: true,
    },
    {
      providerEventId: "2",
      startsAt: 1_800_007_200,
      status: "scheduled",
      home: { key: `${league}:BUF`, name: "Buffalo Bills", abbreviation: "BUF" },
      away: { key: `${league}:NYJ`, name: "New York Jets", abbreviation: "NYJ" },
    },
  ],
  ...over,
});

void describe("poolLiquidityUsdc", () => {
  void it("values a full-range position at the current price: 2·L·√p", () => {
    // L = 1e9 (raw), p = 0.25 → 2 × 1000 × 0.5 = $1000.
    assert.equal(poolLiquidityUsdc("1000000000", 2500), 1000);
    assert.equal(poolLiquidityUsdc(null, 2500), 0);
    assert.equal(poolLiquidityUsdc("not a number", 2500), 0);
    assert.equal(poolLiquidityUsdc("1000000000", undefined), 0);
  });
});

void describe("aggregateDiscoverFills", () => {
  void it("sums 24h volume and counts fills, ignoring older and malformed rows", () => {
    const agg = aggregateDiscoverFills(
      [
        { marketId: "m1", usdcRaw: "25000000", createdAt: new Date(NOW - 3_600_000) },
        { marketId: "m1", usdcRaw: "5000000", createdAt: new Date(NOW - 2 * 86_400_000) },
        { marketId: "m1", usdcRaw: "junk", createdAt: new Date(NOW) },
        { marketId: "m2", usdcRaw: "1000000", createdAt: new Date(NOW - 60_000) },
      ],
      NOW,
    );
    assert.deepEqual(agg.get("m1"), { volume24hRaw: 25_000_000n, fills24h: 1 });
    assert.deepEqual(agg.get("m2"), { volume24hRaw: 1_000_000n, fills24h: 1 });
  });
});

void describe("composeDiscoverMarkets", () => {
  void it("flattens leagues, marks tradeability, and carries liquidity + popularity — no ids", () => {
    const aggregates = new Map<string, DiscoverAggregate>([
      ["1", { liquidityRaw: "4000000000", volume24hRaw: 120_000_000n, fills24h: 7 }],
    ]);
    const out = composeDiscoverMarkets(
      [slate("nfl"), slate("wnba", { delayed: true })],
      aggregates,
    );
    assert.equal(out.markets.length, 4);
    const kc = out.markets.find((m) => m.league === "nfl" && m.providerEventId === "1");
    assert.ok(kc);
    assert.equal(kc.tradeable, true, "live pool + scheduled → tradeable");
    // 2 × 4000 × √0.6 ≈ 6196.77
    assert.equal(Math.round(kc.liquidityUsdc), 6197);
    assert.equal(kc.volume24hUsdc, 120);
    assert.equal(kc.fills24h, 7);
    const buf = out.markets.find((m) => m.league === "nfl" && m.providerEventId === "2");
    assert.ok(buf);
    assert.equal(buf.tradeable, false, "no live pool → browse only");
    assert.equal(buf.liquidityUsdc, 0);
    for (const m of out.markets) {
      assert.ok(!("marketId" in m) && !("poolId" in m), "the wire carries no market id");
    }
    assert.equal(out.delayed, true, "any delayed league marks the whole read");
    assert.equal(out.fetchedAt, NOW - 10_000);
  });

  void it("a final game is never tradeable even with a live pool", () => {
    const s = slate("nfl");
    s.events[0].status = "final";
    const out = composeDiscoverMarkets([s], new Map());
    assert.equal(out.markets[0].tradeable, false);
  });
});
