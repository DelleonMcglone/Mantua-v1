import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { explainMove, NOTABLE_MOVE_BPS, type MoveInput } from "./explain-move.ts";

/**
 * Task 070 / AE-003 — why a price moved: scoring, order flow, repricing
 * ahead of the score, or a thin pool. Pure over the price series, the
 * fills in the window and the game state.
 */

const NOW = 1_800_000_000;
const series = (points: [number, number][]): MoveInput["history"] =>
  points.map(([minsAgo, p]) => ({ t: NOW - minsAgo * 60, p }));

const base: MoveInput = {
  history: series([
    [180, 0.5],
    [90, 0.55],
    [30, 0.6],
    [1, 0.62],
  ]),
  nowSeconds: NOW,
  windowSeconds: 3600,
  flow: { buys: 2, sells: 2 },
  game: {
    status: "scheduled",
    teamScore: null,
    opponentScore: null,
    scoreChanged: false,
    clock: null,
  },
  liquidityUsdc: 12_400,
};

void describe("explainMove", () => {
  void it("measures the move from the last point at or before the window start", () => {
    const m = explainMove(base);
    assert.equal(m.fromBps, 5500);
    assert.equal(m.toBps, 6200);
    assert.equal(m.moveBps, 700);
    assert.equal(m.notable, true);
    assert.equal(NOTABLE_MOVE_BPS, 300);
  });

  void it("is steady below the notable threshold", () => {
    const m = explainMove({
      ...base,
      history: series([
        [90, 0.6],
        [1, 0.62],
      ]),
    });
    assert.equal(m.driver, "steady");
    assert.equal(m.notable, false);
  });

  void it("attributes a live move with a score change to scoring", () => {
    const m = explainMove({
      ...base,
      game: {
        status: "live",
        teamScore: 21,
        opponentScore: 10,
        scoreChanged: true,
        clock: "Q3 8:12",
      },
    });
    assert.equal(m.driver, "scoring");
    assert.ok(m.factors.some((f) => f.includes("21-10")));
  });

  void it("attributes a lopsided flow to order flow", () => {
    const m = explainMove({ ...base, flow: { buys: 9, sells: 1 } });
    assert.equal(m.driver, "order_flow");
    assert.ok(m.factors.some((f) => f.includes("9 buys")));
  });

  void it("calls a move with neither scoring nor heavy flow a repricing", () => {
    const m = explainMove(base);
    assert.equal(m.driver, "repricing");
  });

  void it("calls a move in a thin pool illiquid before anything else", () => {
    const m = explainMove({ ...base, liquidityUsdc: 120, flow: { buys: 9, sells: 0 } });
    assert.equal(m.driver, "illiquid");
  });

  void it("handles a series with fewer than two points", () => {
    const m = explainMove({ ...base, history: series([[1, 0.62]]) });
    assert.equal(m.moveBps, 0);
    assert.equal(m.driver, "steady");
    assert.deepEqual(explainMove({ ...base, history: [] }).toBps, null);
  });
});
