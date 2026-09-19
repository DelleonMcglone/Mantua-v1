import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MoveExplanation } from "./explain-move.ts";
import { priceSignal } from "./price-signal.ts";

/**
 * Task 070 / AE-004 — a changing market price as a signal for public
 * information: a repricing the scoreboard does not explain is read as the
 * market pricing in news before it is public, with a confidence that
 * grows with the size of the move and the depth of the pool.
 */

const move = (driver: MoveExplanation["driver"], moveBps: number): MoveExplanation => ({
  fromBps: 5500,
  toBps: 5500 + moveBps,
  moveBps,
  notable: driver !== "steady",
  driver,
  factors: [],
});
const game = {
  status: "scheduled" as const,
  teamScore: null,
  opponentScore: null,
  scoreChanged: false,
  clock: null,
};

void describe("priceSignal", () => {
  void it("reads a repricing as news implied, favouring the side the price moved toward", () => {
    const s = priceSignal({
      move: move("repricing", 700),
      liquidityUsdc: 12_000,
      game,
      team: "Bills",
    });
    assert.equal(s.kind, "news_implied");
    assert.equal(s.favours, "yes");
    assert.equal(s.confidence, "medium");
    assert.match(s.statement, /Bills/);
    assert.match(s.statement, /before it is public/);
    const down = priceSignal({
      move: move("repricing", -900),
      liquidityUsdc: 12_000,
      game,
      team: "Bills",
    });
    assert.equal(down.favours, "no");
    assert.equal(down.confidence, "high");
  });

  void it("lowers confidence in a shallow pool", () => {
    const s = priceSignal({
      move: move("repricing", 900),
      liquidityUsdc: 800,
      game,
      team: "Bills",
    });
    assert.equal(s.confidence, "low");
  });

  void it("reads one-sided flow as momentum, never above medium confidence", () => {
    const s = priceSignal({
      move: move("order_flow", 900),
      liquidityUsdc: 50_000,
      game,
      team: "Bills",
    });
    assert.equal(s.kind, "momentum");
    assert.equal(s.confidence, "medium");
    assert.match(s.statement, /can be noise/);
  });

  void it("reads a scoring move as confirmed by the scoreboard", () => {
    const s = priceSignal({
      move: move("scoring", 900),
      liquidityUsdc: 50_000,
      game: { ...game, status: "live", teamScore: 21, opponentScore: 10, scoreChanged: true },
      team: "Bills",
    });
    assert.equal(s.kind, "score_confirmed");
    assert.equal(s.favours, "yes");
  });

  void it("has nothing to say about a steady or illiquid market", () => {
    assert.equal(
      priceSignal({ move: move("steady", 100), liquidityUsdc: 50_000, game, team: "Bills" }).kind,
      "none",
    );
    assert.equal(
      priceSignal({ move: move("illiquid", 900), liquidityUsdc: 100, game, team: "Bills" }).kind,
      "none",
    );
  });
});
