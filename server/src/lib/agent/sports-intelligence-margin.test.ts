import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeSide, ESTIMATOR_WEIGHTS, type AnalysisFacts } from "./sports-intelligence.ts";

/**
 * Task 079 slice 3 — the point-differential term exists, is weighted by
 * `marginBpsPerPoint`, and ships OFF (weight 0) because the reconstruction
 * found no setting that beat the results-only baseline out of sample
 * (docs/tasks/079 §8, D-126). These tests pin the term's arithmetic under
 * an override so it can be switched on deliberately, and pin that it is
 * silent while the deployed weight is 0.
 */
function facts(over: Partial<AnalysisFacts> = {}): AnalysisFacts {
  return {
    league: "nfl",
    side: "home",
    team: {
      name: "A",
      record: { wins: 4, losses: 4, ties: 0 },
      recentForm: ["W", "L", "W", "L"],
      injuries: [],
      // +80 over 8 games: +10/game raw, +5/game after the 8-game shrink.
      margin: { pointsFor: 240, pointsAgainst: 160, games: 8 },
    },
    opponent: {
      name: "B",
      record: { wins: 4, losses: 4, ties: 0 },
      recentForm: ["L", "W", "L", "W"],
      injuries: [],
      // −80 over 8 games: −5/game after the shrink.
      margin: { pointsFor: 160, pointsAgainst: 240, games: 8 },
    },
    headToHead: null,
    live: null,
    gameStatus: "scheduled",
    marketImpliedBps: null,
    marketAgeSeconds: null,
    liquidityUsdc: null,
    delayed: false,
    ...over,
  };
}

const effect = (a: ReturnType<typeof analyzeSide>) =>
  a.evidence.find((e) => e.factor === "point differential")?.effectBps ?? null;

void describe("point differential (Task 079 slice 3)", () => {
  void it("ships off: weight 0, no evidence, estimate unchanged by scores", () => {
    assert.equal(ESTIMATOR_WEIGHTS["marginBpsPerPoint"], 0);
    const withScores = analyzeSide(facts());
    const without = analyzeSide(
      facts({
        team: { ...facts().team, margin: null },
        opponent: { ...facts().opponent, margin: null },
      }),
    );
    assert.equal(effect(withScores), null);
    assert.equal(withScores.probabilityBps, without.probabilityBps);
    assert.match(withScores.method, /point differential \(off\)/);
  });

  void it("under an override: gap in shrunk margin per game × bps per point", () => {
    // (+5) − (−5) = 10 points/game × 100 bps = 1000.
    const a = analyzeSide(facts(), { marginBpsPerPoint: 100 });
    assert.equal(effect(a), 1000);
    assert.match(a.method, /gap × 100\/pt, capped ±1500/);
  });

  void it("is capped and symmetric", () => {
    const a = analyzeSide(facts(), { marginBpsPerPoint: 400 });
    assert.equal(effect(a), 1500);
    const b = analyzeSide(facts({ side: "away", team: facts().opponent, opponent: facts().team }), {
      marginBpsPerPoint: 400,
    });
    assert.equal(effect(b), -1500);
  });

  void it("heavier shrinkage pulls the term toward zero", () => {
    const light = effect(analyzeSide(facts(), { marginBpsPerPoint: 50, marginPriorGames: 0 }));
    const heavy = effect(analyzeSide(facts(), { marginBpsPerPoint: 50, marginPriorGames: 32 }));
    assert.equal(light, 1000); // 10 − (−10) = 20/game × 50
    assert.equal(heavy, 200); // 80/40 = 2 each way → 4 × 50
  });

  void it("is silent when either side has no scores on file", () => {
    const a = analyzeSide(facts({ opponent: { ...facts().opponent, margin: null } }), {
      marginBpsPerPoint: 100,
    });
    assert.equal(effect(a), null);
  });
});
