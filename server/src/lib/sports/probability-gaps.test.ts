import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gapRowFromAnalysis, rankGaps, type GapRow } from "./probability-gaps.ts";

const row = (game: string, gapPoints: number, liquidityUsdc: number | null): GapRow => ({
  game,
  providerEventId: game,
  outcome: game,
  marketId: "0x" + "0".repeat(64),
  marketProbabilityBps: 5000,
  mantuaProbabilityBps: 5000 + gapPoints * 100,
  gapPoints,
  confidence: "medium",
  liquidityUsdc,
  drivers: [],
  reference: "pool",
});

void describe("rankGaps", () => {
  void it("orders by the size of the gap in either direction, then by liquidity", () => {
    const ranked = rankGaps(
      [
        row("small", 2, 900),
        row("big-negative", -12, 100),
        row("big-positive", 12, 400),
        row("mid", 7, 50),
      ],
      3,
    );
    assert.deepEqual(
      ranked.map((r) => r.game),
      ["big-positive", "big-negative", "mid"],
    );
  });
});

void describe("gapRowFromAnalysis", () => {
  const event = {
    id: "e1",
    leagueId: "l1",
    providerEventId: "401",
    homeTeam: "Cleveland Browns",
    awayTeam: "Pittsburgh Steelers",
    homeTeamKey: null,
    awayTeamKey: null,
    homeTeamId: null,
    awayTeamId: null,
    startsAt: new Date(),
    status: "scheduled",
    homeScore: null,
    awayScore: null,
  };
  void it("turns one analysis into a gap row in percentage points", () => {
    const r = gapRowFromAnalysis(event, {
      team: "Cleveland Browns",
      market: { marketId: "0xabc", impliedProbabilityBps: 5500, liquidityUsdc: 120 },
      analysis: {
        probabilityBps: 7600,
        confidence: "high",
        evidence: [{ factor: "record", detail: "7-3 vs 4-6" }],
      },
    });
    assert.ok(r);
    assert.equal(r.gapPoints, 21);
    assert.equal(r.game, "Pittsburgh Steelers at Cleveland Browns");
    assert.deepEqual(r.drivers, ["record: 7-3 vs 4-6"]);
    assert.equal(r.reference, "pool");
  });
  void it("compares with the sportsbook line while no market is open, and says so", () => {
    const r = gapRowFromAnalysis(event, {
      team: "Cleveland Browns",
      market: null,
      bookLine: { impliedProbabilityBps: 6100 },
      analysis: { probabilityBps: 5200, confidence: "medium", evidence: [] },
    });
    assert.ok(r);
    assert.equal(r.reference, "book");
    assert.equal(r.marketProbabilityBps, 6100);
    assert.equal(r.gapPoints, -9);
    assert.equal(r.marketId, "");
  });
  void it("skips a game with neither a pool price nor a book line", () => {
    assert.equal(
      gapRowFromAnalysis(event, {
        market: { marketId: "0xabc", impliedProbabilityBps: null, liquidityUsdc: null },
        analysis: { probabilityBps: 6000, confidence: "low", evidence: [] },
      }),
      null,
    );
  });
});
