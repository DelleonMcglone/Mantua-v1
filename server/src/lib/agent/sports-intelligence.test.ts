import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EDGE_THRESHOLD_BPS, analyzeSide, type AnalysisFacts } from "./sports-intelligence.ts";

/** Phase 8 / A-004, A-022 — the estimator is transparent and bounded. */

function facts(over: Partial<AnalysisFacts> = {}): AnalysisFacts {
  return {
    league: "nfl",
    side: "home",
    team: {
      name: "Atlanta Falcons",
      record: { wins: 7, losses: 3, ties: 0 },
      recentForm: ["W", "W", "L", "W", "W"],
      injuries: [{ status: "questionable", player: "Dee Catchman", position: "WR" }],
    },
    opponent: {
      name: "New Orleans Saints",
      record: { wins: 4, losses: 6, ties: 0 },
      recentForm: ["L", "W", "L", "L", "W"],
      injuries: [],
    },
    headToHead: { teamWins: 2, opponentWins: 1, ties: 0 },
    live: null,
    gameStatus: "scheduled",
    marketImpliedBps: 5500,
    marketAgeSeconds: 120,
    liquidityUsdc: 2500,
    delayed: false,
    ...over,
  };
}

void describe("analyzeSide", () => {
  void it("adds up the evidence transparently and suggests the cheap side", () => {
    const a = analyzeSide(facts());
    // venue +250, record (0.7−0.4)×5000 = +1500, form (0.8−0.4)×2000 = +800,
    // injuries −100, h2h (2/3−0.5)×800 = +133 → 7583.
    assert.equal(a.probabilityBps, 7583);
    const sum = a.evidence.reduce((acc, e) => acc + e.effectBps, 0);
    assert.equal(5000 + sum, a.probabilityBps);
    assert.equal(a.discrepancyBps, 7583 - 5500);
    assert.equal(a.suggestedAction.kind, "consider_buy_yes");
    assert.equal(a.confidence, "high");
    assert.ok(a.disclaimers.length >= 2);
  });

  void it("flips with the side, suggests the fade when the market is rich, holds inside the threshold", () => {
    const away = analyzeSide(facts({ side: "away" }));
    assert.equal(away.probabilityBps, 7583 - 500);
    const rich = analyzeSide(facts({ marketImpliedBps: 9000 }));
    assert.equal(rich.suggestedAction.kind, "consider_fade");
    const flat = analyzeSide(facts({ marketImpliedBps: 7583 - EDGE_THRESHOLD_BPS + 1 }));
    assert.equal(flat.suggestedAction.kind, "hold");
  });

  void it("names risks: missing data, stale price, thin pool, delayed slate, live play, final", () => {
    const thin = analyzeSide(
      facts({
        team: { ...facts().team, record: null, recentForm: ["W"] },
        marketAgeSeconds: 40 * 60,
        liquidityUsdc: 100,
        delayed: true,
        live: { teamScore: 3, opponentScore: 17 },
      }),
    );
    const risks = thin.riskFactors.join(" | ");
    assert.match(risks, /no season record/);
    assert.match(risks, /fewer than three games/);
    assert.match(risks, /40 min old/);
    assert.match(risks, /thin pool/);
    assert.match(risks, /delayed copy/);
    assert.match(risks, /in-play/);
    assert.notEqual(thin.confidence, "high");
    // Live margin −14 → −3000 (capped), so the estimate collapses below the market.
    assert.ok(thin.probabilityBps < 5500);
    const done = analyzeSide(facts({ gameStatus: "final" }));
    assert.equal(done.suggestedAction.kind, "hold");
    assert.match(done.riskFactors.join(" | "), /final/);
  });

  void it("has no suggestion without a market price and stays clamped", () => {
    const none = analyzeSide(facts({ marketImpliedBps: null, marketAgeSeconds: null }));
    assert.equal(none.discrepancyBps, null);
    assert.equal(none.suggestedAction.kind, "no_market_price");
    const blowout = analyzeSide(facts({ live: { teamScore: 60, opponentScore: 0 } }));
    assert.equal(blowout.probabilityBps, 9500);
    const rout = analyzeSide(
      facts({
        side: "away",
        team: {
          ...facts().team,
          record: { wins: 0, losses: 10, ties: 0 },
          recentForm: ["L", "L", "L", "L", "L"],
        },
        opponent: {
          ...facts().opponent,
          record: { wins: 10, losses: 0, ties: 0 },
          recentForm: ["W", "W", "W", "W", "W"],
        },
        live: { teamScore: 0, opponentScore: 60 },
      }),
    );
    assert.equal(rout.probabilityBps, 500);
  });
});
