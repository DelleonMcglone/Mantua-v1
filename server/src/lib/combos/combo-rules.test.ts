import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type LegRuleOptions,
  comboLabel,
  comboPlayoffs,
  comboStartsAt,
  validateLegs,
  type LegCandidate,
} from "./combo-rules.ts";

/** Task 072 / CB-001, CB-010 — the leg rules name every violation. */

const NOW = 1_800_000_000;

function leg(over: Partial<LegCandidate> & { marketId: string; teamName: string }): LegCandidate {
  return {
    providerEventId: over.teamName,
    outcomeIndex: 0,
    opponentName: "Opp",
    league: "nfl",
    kickoffAt: NOW + 3600,
    marketState: "OPEN",
    eventStatus: "scheduled",
    priceBps: 5_000,
    playoffs: false,
    ...over,
    marketId: over.marketId,
  };
}

const opts: LegRuleOptions = { maxLegs: 4, nowSeconds: NOW };
const codes = (legs: LegCandidate[], o: LegRuleOptions = opts) =>
  validateLegs(legs, o).map((v) => v.code);

void describe("validateLegs", () => {
  void it("accepts a clean two-leg set", () => {
    assert.deepEqual(
      codes([leg({ marketId: "0xa", teamName: "A" }), leg({ marketId: "0xb", teamName: "B" })]),
      [],
    );
  });

  void it("refuses too few and too many", () => {
    assert.deepEqual(codes([leg({ marketId: "0xa", teamName: "A" })]), ["too_few"]);
    const five = ["a", "b", "c", "d", "e"].map((t) => leg({ marketId: `0x${t}`, teamName: t }));
    assert.deepEqual(codes(five), ["too_many"]);
  });

  void it("names a duplicate market, one game twice, and one team twice", () => {
    const a = leg({ marketId: "0xa", teamName: "A", providerEventId: "g1", opponentName: "B" });
    assert.ok(
      codes([a, leg({ marketId: "0xA", teamName: "A2", providerEventId: "g9" })]).includes(
        "duplicate_market",
      ),
    );
    const b = leg({
      marketId: "0xb",
      teamName: "B",
      providerEventId: "g1",
      outcomeIndex: 1,
      opponentName: "A",
    });
    const v = validateLegs([a, b], opts);
    assert.equal(v[0]?.code, "same_event");
    assert.equal(v[0]?.marketId, "0xb");
    assert.match(v[0]?.detail ?? "", /play each other/);
    assert.ok(
      codes([a, leg({ marketId: "0xc", teamName: "a", providerEventId: "g2" })]).includes(
        "same_team",
      ),
    );
  });

  void it("refuses a leg whose market is not open or whose game is over", () => {
    const base = leg({ marketId: "0xa", teamName: "A" });
    assert.ok(
      codes([base, leg({ marketId: "0xb", teamName: "B", marketState: "FROZEN" })]).includes(
        "leg_not_open",
      ),
    );
    assert.ok(
      codes([base, leg({ marketId: "0xb", teamName: "B", marketState: null })]).includes(
        "leg_not_open",
      ),
    );
    assert.ok(
      codes([base, leg({ marketId: "0xb", teamName: "B", eventStatus: "final" })]).includes(
        "leg_final",
      ),
    );
    assert.ok(
      codes([base, leg({ marketId: "0xb", teamName: "B", kickoffAt: NOW - 13 * 3600 })]).includes(
        "leg_final",
      ),
    );
    // In play is fine (D-103): kickoff passed, game running.
    assert.deepEqual(
      codes([
        base,
        leg({ marketId: "0xb", teamName: "B", kickoffAt: NOW - 600, eventStatus: "in_progress" }),
      ]),
      [],
    );
  });

  void it("applies the allowed leagues and requires a price", () => {
    const a = leg({ marketId: "0xa", teamName: "A", league: "wnba" });
    const b = leg({ marketId: "0xb", teamName: "B", priceBps: null });
    const v = validateLegs([a, b], { ...opts, allowedLeagues: ["nfl"] });
    assert.deepEqual(
      v.map((x) => x.code),
      ["league_not_allowed", "leg_unpriced"],
    );
    assert.deepEqual(
      codes([a, leg({ marketId: "0xb", teamName: "B" })], { ...opts, allowedLeagues: [] }),
      [],
    );
  });
});

void describe("combo label, startsAt, playoffs", () => {
  void it("derives the market label, the latest kickoff and the season flag", () => {
    const legs = [
      leg({ marketId: "0xa", teamName: "Cowboys", kickoffAt: 100 }),
      leg({ marketId: "0xb", teamName: "Chiefs", kickoffAt: 300, playoffs: true }),
      leg({ marketId: "0xc", teamName: "Raiders", kickoffAt: 200 }),
    ];
    assert.equal(comboLabel(legs), "Cowboys + Chiefs + Raiders");
    assert.equal(comboStartsAt(legs), 300);
    assert.equal(comboPlayoffs(legs), true);
    assert.equal(comboPlayoffs(legs.slice(0, 1)), false);
  });
});
