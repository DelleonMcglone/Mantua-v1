import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeSide, ESTIMATOR_WEIGHTS, type AnalysisFacts } from "./sports-intelligence.ts";

/**
 * Reliability brief (2026-10-30), Goals 2 and 3: the forecast is auditable
 * term by term, and an absence the team has already played without is not
 * penalised a second time (D-127).
 */
function facts(over: Partial<AnalysisFacts> = {}): AnalysisFacts {
  return {
    league: "nfl",
    side: "home",
    team: {
      name: "Green Bay Packers",
      record: { wins: 4, losses: 3, ties: 0 },
      recentForm: ["L", "W", "W", "W", "L"],
      injuries: [],
    },
    opponent: {
      name: "Carolina Panthers",
      record: { wins: 3, losses: 3, ties: 0 },
      recentForm: ["L", "W", "W", "L", "W"],
      injuries: [],
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

const withInjuries = (team: AnalysisFacts["team"]["injuries"]) =>
  analyzeSide(facts({ team: { ...facts().team, injuries: team } }));
const penalty = (team: AnalysisFacts["team"]["injuries"]) =>
  analyzeSide(facts()).probabilityBps - withInjuries(team).probabilityBps;

void describe("Goal 2 — attribution reproduces the published number", () => {
  void it("baseline + terms = sum = final when nothing clamps", () => {
    const a = analyzeSide(facts());
    assert.equal(a.attribution.units, "bps");
    assert.equal(a.attribution.baselineBps, 5000);
    const sum = a.attribution.terms.reduce((s, t) => s + t.effectBps, 0);
    assert.equal(a.attribution.sumBps, 5000 + sum);
    assert.equal(a.attribution.finalBps, a.probabilityBps);
    assert.equal(a.attribution.clampedTo, null);
    assert.deepEqual(
      a.attribution.terms.map((t) => t.factor),
      a.evidence.map((e) => e.factor),
    );
  });

  void it("records the clamp when the sum leaves the 5–95% band", () => {
    const a = analyzeSide(
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
        live: { teamScore: 0, opponentScore: 49 },
      }),
    );
    assert.equal(a.attribution.clampedTo, 500);
    assert.ok(a.attribution.sumBps < 500);
    assert.equal(a.attribution.finalBps, 500);
  });
});

void describe("Goal 3 — incremental injury accounting", () => {
  void it("a newly reported starter out costs the full weight and says why", () => {
    const a = withInjuries([
      {
        status: "out",
        player: "Micah Parsons",
        position: "DE",
        reportedAt: "2026-10-28",
        gamesSince: 0,
      },
    ]);
    const c = a.injuryContributions.team[0];
    assert.ok(c);
    assert.equal(c.impactBps, ESTIMATOR_WEIGHTS["playerOutBps"]);
    assert.equal(c.player, "Micah Parsons");
    assert.equal(c.reportedAt, "2026-10-28");
    assert.equal(c.gamesSince, 0);
    assert.match(c.rationale, /out or doubtful/);
  });

  void it("a season-long absence the team has played three finals without costs nothing", () => {
    const longStanding = [
      {
        status: "ir",
        player: "Jacob Monk",
        position: "C",
        reportedAt: "2026-09-15",
        gamesSince: 5,
      },
      { status: "out", player: "Someone", position: "G", reportedAt: "2026-09-20", gamesSince: 4 },
    ];
    assert.equal(penalty(longStanding), 0);
    const items = withInjuries(longStanding).injuryContributions.team;
    assert.equal(items.length, 2);
    for (const c of items) {
      assert.equal(c.impactBps, 0);
      assert.match(c.rationale, /long-standing/);
    }
  });

  void it("a quarterback on IR counts while recent and stops once the record has absorbed him", () => {
    assert.equal(
      penalty([{ status: "ir", player: "Jalen Hurts", position: "QB", gamesSince: 0 }]),
      ESTIMATOR_WEIGHTS["qbOutBps"],
    );
    assert.equal(
      penalty([{ status: "ir", player: "Jalen Hurts", position: "QB", gamesSince: 2 }]),
      ESTIMATOR_WEIGHTS["qbOutBps"],
    );
    assert.equal(
      penalty([{ status: "ir", player: "Jalen Hurts", position: "QB", gamesSince: 3 }]),
      0,
    );
  });

  void it("without gamesSince (legacy callers) the old rules apply unchanged", () => {
    assert.equal(penalty([{ status: "out", player: "A", position: "G" }]), 150);
    assert.equal(penalty([{ status: "questionable", player: "B", position: "WR" }]), 50);
    assert.equal(penalty([{ status: "ir", player: "C", position: "RB" }]), 0);
  });

  void it("overlapping position-group injuries still cap at 2000 and the evidence says how many counted", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      status: "out",
      player: `P${String(i)}`,
      position: "G",
      gamesSince: 0,
    }));
    const a = withInjuries(many);
    assert.equal(penalty(many), ESTIMATOR_WEIGHTS["injuryCapBps"]);
    const ev = a.evidence.find((e) => e.factor === "injuries");
    assert.match(ev?.detail ?? "", /20 of 20 open counted/);
  });

  void it("a returning starter (status cleared) carries no weight and is listed as such", () => {
    const a = withInjuries([{ status: "active", player: "Back", position: "WR", gamesSince: 0 }]);
    assert.equal(a.injuryContributions.team[0]?.impactBps, 0);
    assert.match(a.injuryContributions.team[0]?.rationale ?? "", /carries no weight/);
  });
});
