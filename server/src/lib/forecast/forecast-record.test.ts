import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  boundedSnapshot,
  forecastFromAnalysis,
  SNAPSHOT_MAX_CHARS,
  type ForecastContext,
} from "./forecast-record.ts";

/** The forecast ledger: a row is a projection of the analyze tool's output. */

const NOW = new Date("2026-10-24T15:00:00Z");
const KICKOFF = "2026-10-25T17:00:00Z";

const ctx: ForecastContext = {
  userId: "u1",
  sessionId: "s1",
  source: "research",
  action: "no_trade",
  modelVersion: "abc123",
  tool: { name: "mantua_analyze_market", args: { team: "Chiefs" } },
};

function analysis(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "ok",
    game: { providerEventId: "401", league: "nfl", startsAt: KICKOFF },
    side: "home",
    team: "Kansas City Chiefs",
    opponent: "Las Vegas Raiders",
    bookLine: { impliedProbabilityBps: 6400, source: "sportsbook closing line, vig removed" },
    market: {
      marketId: "0xm",
      outcomeIndex: 0,
      impliedProbabilityBps: 6100,
      liquidityUsdc: 1234.5,
    },
    analysis: {
      probabilityBps: 6800,
      confidence: "medium",
      method: "evidence-weighted",
      evidence: [{ factor: "record", detail: "5-1 vs 2-4", effectBps: 900 }],
      riskFactors: [],
      suggestedAction: { kind: "consider_buy_yes", rationale: "edge" },
    },
    inputs: {
      team: { record: { wins: 5, losses: 1, ties: 0 } },
      opponent: {},
      headToHead: null,
      live: null,
    },
    ...overrides,
  };
}

void describe("forecastFromAnalysis", () => {
  void it("projects the probability, both references, the side and the inputs into a row", () => {
    const row = forecastFromAnalysis(analysis(), ctx, NOW);
    assert.ok(row);
    assert.equal(row.agentProbabilityBps, 6800);
    assert.equal(row.confidence, "medium");
    assert.equal(row.referenceBookBps, 6400);
    assert.equal(row.referencePoolBps, 6100);
    assert.equal(row.liquidityUsdc, "1234.500000");
    assert.equal(row.marketId, "0xm");
    assert.equal(row.outcomeIndex, 0);
    assert.equal(row.outcomeLabel, "Kansas City Chiefs win");
    assert.equal(row.league, "nfl");
    assert.equal(row.eventStartsAt.toISOString(), "2026-10-25T17:00:00.000Z");
    assert.equal(row.source, "research");
    assert.equal(row.action, "no_trade");
    assert.equal(row.modelVersion, "abc123");
    assert.equal(row.afterKickoff, false);
    const snap = row.inputsSnapshot as Record<string, unknown>;
    assert.deepEqual(snap["tool"], ctx.tool);
    assert.ok(snap["inputs"]);
    assert.ok(Array.isArray(snap["evidence"]));
  });

  void it("records a game with no market yet against the book line only, away side as outcome 1", () => {
    const row = forecastFromAnalysis(analysis({ market: null, side: "away" }), ctx, NOW);
    assert.ok(row);
    assert.equal(row.marketId, null);
    assert.equal(row.referencePoolBps, null);
    assert.equal(row.liquidityUsdc, null);
    assert.equal(row.outcomeIndex, 1);
  });

  void it("flags a view formed at or after kickoff — kept, never scored", () => {
    const atKickoff = forecastFromAnalysis(analysis(), ctx, new Date(KICKOFF));
    assert.ok(atKickoff);
    assert.equal(atKickoff.afterKickoff, true);
    const later = forecastFromAnalysis(analysis(), ctx, new Date("2026-10-25T19:00:00Z"));
    assert.ok(later);
    assert.equal(later.afterKickoff, true);
  });

  void it("carries the fill's trade id and action", () => {
    const row = forecastFromAnalysis(
      analysis(),
      { ...ctx, source: "proposal", action: "filled", tradeId: "0xtx" },
      NOW,
    );
    assert.ok(row);
    assert.equal(row.action, "filled");
    assert.equal(row.tradeId, "0xtx");
  });

  void it("records nothing for a tool answer without a probability", () => {
    assert.equal(forecastFromAnalysis({ status: "not_found" }, ctx, NOW), null);
    assert.equal(forecastFromAnalysis({ status: "unavailable" }, ctx, NOW), null);
  });

  void it("bounds the snapshot by dropping the raw inputs, never the evidence", () => {
    const big = { tool: ctx.tool, inputs: { blob: "x".repeat(SNAPSHOT_MAX_CHARS) }, evidence: [1] };
    const out = boundedSnapshot(big);
    assert.equal(out["inputs"], null);
    assert.equal(out["truncated"], true);
    assert.deepEqual(out["evidence"], [1]);
    assert.ok(JSON.stringify(out).length < SNAPSHOT_MAX_CHARS);
  });
});
