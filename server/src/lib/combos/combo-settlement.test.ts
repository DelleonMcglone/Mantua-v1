import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  comboOutcome,
  legResultFrom,
  planComboResolution,
  ticketStatusFor,
} from "./combo-settlement.ts";

/** Task 072 / CB-007 — the conjunction rule and the resolution plan. */

void describe("legResultFrom", () => {
  void it("reads a leg's result from its market state and the logged winner", () => {
    assert.equal(legResultFrom("OPEN", null), "pending");
    assert.equal(legResultFrom("FROZEN", null), "pending");
    assert.equal(legResultFrom("RESOLVED", 0), "won");
    assert.equal(legResultFrom("SETTLED", 1), "lost");
    assert.equal(legResultFrom("RESOLVED", null), "pending");
    assert.equal(legResultFrom("INVALID", null), "void");
  });
});

void describe("comboOutcome", () => {
  void it("any lost → lost, even with legs pending", () => {
    assert.equal(comboOutcome(["won", "lost", "pending"]).kind, "lost");
  });
  void it("all non-void won → won; a void leg drops out", () => {
    assert.equal(comboOutcome(["won", "won"]).kind, "won");
    assert.equal(comboOutcome(["won", "void", "won"]).kind, "won");
  });
  void it("every leg void → void; otherwise pending", () => {
    assert.equal(comboOutcome(["void", "void"]).kind, "void");
    assert.equal(comboOutcome(["won", "pending"]).kind, "pending");
    assert.equal(comboOutcome(["void", "pending"]).kind, "pending");
    assert.equal(comboOutcome([]).kind, "pending");
    assert.deepEqual(comboOutcome(["won", "void", "pending"]), {
      kind: "pending",
      won: 1,
      lost: 0,
      void: 1,
      pending: 1,
    });
  });
});

void describe("planComboResolution", () => {
  const id = "0xc" as `0x${string}`;
  void it("freezes then resolves a decided OPEN combo once its startsAt has passed", () => {
    const plan = planComboResolution(
      [{ comboMarketId: id, startsAt: 100, marketState: "OPEN", legResults: ["won", "lost"] }],
      150,
    );
    assert.deepEqual(
      plan.map((a) => [a.kind, a.outcome]),
      [
        ["freeze", undefined],
        ["resolve", 1],
      ],
    );
  });
  void it("waits for startsAt before freezing an early loss, but voids regardless", () => {
    assert.deepEqual(
      planComboResolution(
        [
          {
            comboMarketId: id,
            startsAt: 200,
            marketState: "OPEN",
            legResults: ["lost", "pending"],
          },
        ],
        150,
      ),
      [],
    );
    const v = planComboResolution(
      [{ comboMarketId: id, startsAt: 200, marketState: "OPEN", legResults: ["void", "void"] }],
      150,
    );
    assert.equal(v[0]?.kind, "void");
  });
  void it("resolves a FROZEN combo without a freeze and skips settled or pending ones", () => {
    const plan = planComboResolution(
      [
        { comboMarketId: id, startsAt: 100, marketState: "FROZEN", legResults: ["won", "won"] },
        { comboMarketId: id, startsAt: 100, marketState: "RESOLVED", legResults: ["won", "won"] },
        { comboMarketId: id, startsAt: 100, marketState: "OPEN", legResults: ["won", "pending"] },
      ],
      150,
    );
    assert.deepEqual(
      plan.map((a) => [a.kind, a.outcome]),
      [["resolve", 0]],
    );
  });
  void it("maps a verdict to the ticket status", () => {
    assert.equal(ticketStatusFor(comboOutcome(["won"])), "won");
    assert.equal(ticketStatusFor(comboOutcome(["pending"])), null);
  });
});
