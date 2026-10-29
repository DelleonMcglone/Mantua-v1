import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeSide, ESTIMATOR_WEIGHTS, type AnalysisFacts } from "./sports-intelligence.ts";

/**
 * Task 079 — the Green Bay 51.2% reconstruction (owner audit, 2026-10-29).
 *
 * The inputs below are the exact `inputs` block `/api/markets/analysis`
 * returned for Packers (home) vs Panthers, providerEventId 401873023, at
 * 23:05 UTC on 2026-10-29 — 70 minutes before kickoff. The sportsbook
 * reference at that moment was 6164 bps (DraftKings −180 / +150, vig
 * removed proportionally). This fixture pins the arithmetic so a weight
 * change that moves the number shows up here, by name, with its new value.
 */
const GREEN_BAY: AnalysisFacts = {
  league: "nfl",
  side: "home",
  team: {
    name: "Green Bay Packers",
    record: { wins: 4, losses: 3, ties: 0 },
    recentForm: ["L", "W", "W", "W", "L"],
    injuries: [
      { status: "out", player: "Micah Parsons", position: "DE" },
      { status: "out", player: "Zaire Franklin", position: "LB" },
      { status: "out", player: "Travis Glover", position: "OT" },
      { status: "questionable", player: "Brenton Cox Jr.", position: "DE" },
      { status: "out", player: "Sean Rhyan", position: "G" },
      { status: "questionable", player: "Matthew Golden", position: "WR" },
      { status: "ir", player: "Jacob Monk", position: "C" },
      { status: "questionable", player: "Anthony Campbell", position: "DT" },
      { status: "questionable", player: "Devonte Wyatt", position: "DT" },
    ],
  },
  opponent: {
    name: "Carolina Panthers",
    record: { wins: 3, losses: 3, ties: 0 },
    recentForm: ["L", "W", "W", "L", "W"],
    injuries: [
      { status: "questionable", player: "Bobby Brown III", position: "DT" },
      { status: "out", player: "Jaelan Phillips", position: "LB" },
      { status: "out", player: "Damien Lewis", position: "G" },
      { status: "out", player: "Torricelli Simpkins III", position: "G" },
      { status: "ir", player: "Taylor Moton", position: "OT" },
    ],
  },
  headToHead: null,
  live: null,
  gameStatus: "scheduled",
  marketImpliedBps: null,
  marketAgeSeconds: null,
  liquidityUsdc: null,
  delayed: false,
};

const BOOK_BPS = 6164;

function effect(a: ReturnType<typeof analyzeSide>, factor: string): number {
  const e = a.evidence.find((x) => x.factor === factor);
  assert.ok(e, `evidence has ${factor}`);
  return e.effectBps;
}

describe("Green Bay 51.2% — reconstruction from the recorded inputs", () => {
  const a = analyzeSide(GREEN_BAY);

  it("reproduces 5117 bps, which displays as 51.2%", () => {
    assert.equal(a.probabilityBps, 5117);
    assert.equal((a.probabilityBps / 100).toFixed(1), "51.2");
  });

  it("venue: +250 for the home side", () => {
    assert.equal(effect(a, "venue"), ESTIMATOR_WEIGHTS["homeAdvantageBps"]);
  });

  it("season record: 4-3 vs 3-3 is worth 167 bps after the 8-game prior", () => {
    // (4 + 4) / (7 + 8) = 0.5333 ; (3 + 4) / (6 + 8) = 0.5 ; gap × 5000 = 166.7
    assert.equal(effect(a, "season record"), 167);
  });

  it("recent form: three wins in five on both sides nets to zero", () => {
    assert.equal(effect(a, "recent form"), 0);
  });

  it("injuries: Green Bay 800 (4 out, 4 questionable, IR centre uncounted) vs Carolina 500 → −300", () => {
    assert.equal(effect(a, "injuries"), -300);
  });

  it("head-to-head: absent — the catalog holds no prior meeting", () => {
    assert.equal(
      a.evidence.some((e) => e.factor === "head-to-head"),
      false,
    );
  });

  it("adds up: 5000 + 250 + 167 + 0 − 300 = 5117", () => {
    const sum = a.evidence.reduce((acc, e) => acc + e.effectBps, 0);
    assert.equal(5000 + sum, a.probabilityBps);
  });

  it("the away side is the exact complement (4883)", () => {
    const away = analyzeSide({
      ...GREEN_BAY,
      side: "away",
      team: GREEN_BAY.opponent,
      opponent: GREEN_BAY.team,
    });
    assert.equal(away.probabilityBps, 10_000 - a.probabilityBps);
  });

  it("sits 1047 bps under the de-vigged book (6164) and still reports high confidence", () => {
    assert.equal(a.probabilityBps - BOOK_BPS, -1047);
    // Audit finding F-7: confidence is a breadth-of-evidence label, not a
    // validated accuracy claim. Pinned so a change to the rule is deliberate.
    assert.equal(a.confidence, "high");
  });

  it("a star non-quarterback absence weighs the same as any other player (150 bps)", () => {
    // Audit finding F-4: Micah Parsons out moves Green Bay exactly as much
    // as a backup guard would. Pinned, not endorsed.
    const without = analyzeSide({
      ...GREEN_BAY,
      team: {
        ...GREEN_BAY.team,
        injuries: GREEN_BAY.team.injuries.filter((i) => i.player !== "Micah Parsons"),
      },
    });
    assert.equal(without.probabilityBps - a.probabilityBps, ESTIMATOR_WEIGHTS["playerOutBps"]);
  });
});
