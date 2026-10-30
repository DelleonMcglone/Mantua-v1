import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allowedWeekdays, caveatLine, checkNarrative } from "./narrative-check.ts";

// The reference turn: Green Bay analysis, 70 minutes before a Thursday kickoff.
const NOW = new Date("2026-10-29T23:05:00Z");
const ANALYSIS = {
  status: "ok",
  team: "Green Bay Packers",
  timing: { phase: "pregame", weekdayEastern: "Thu", hoursToKickoff: 1.2 },
  edge: { status: "no_market", gapVsBookBps: -1047 },
  bookLine: { impliedProbabilityBps: 6164, gapPoints: -10.5 },
  market: null,
  analysis: {
    probabilityBps: 5117,
    attribution: { baselineBps: 5000, terms: [{ factor: "venue", effectBps: 250 }], sumBps: 5117 },
  },
};

void describe("checkNarrative (Goal 7)", () => {
  void it("passes prose whose figures all come from the turn's tool results", () => {
    const c = checkNarrative(
      "Mantua has Green Bay at 51.2% (5117 bps) against a 61.6% book, a 1047 bps gap — a candidate discrepancy, not an edge. Inactives are due within the hour.",
      [ANALYSIS],
      NOW,
    );
    assert.deepEqual(c.violations, []);
    assert.equal(c.ok, true);
    assert.equal(c.figuresChecked, 4);
  });

  void it("accepts display rounding of a bps value (51%, 62%)", () => {
    const c = checkNarrative("Green Bay 51%, book 62%.", [ANALYSIS], NOW);
    assert.equal(c.ok, true);
  });

  void it("flags a percentage nothing on the turn produced", () => {
    const c = checkNarrative("Green Bay 47% tonight.", [ANALYSIS], NOW);
    assert.equal(c.ok, false);
    assert.equal(c.violations[0]?.kind, "unsupported_figure");
    assert.equal(c.violations[0]?.excerpt, "47%");
  });

  void it("flags value language when no analysis on the turn is qualified", () => {
    const c = checkNarrative("The gap suggests Carolina value.", [ANALYSIS], NOW);
    assert.equal(
      c.violations.some((v) => v.kind === "edge_claim"),
      true,
    );
  });

  void it("lets value language through when it is disclaimed or the edge is qualified", () => {
    const ok = checkNarrative(
      "Carolina looks like value, but this is a candidate discrepancy only.",
      [ANALYSIS],
      NOW,
    );
    assert.equal(
      ok.violations.some((v) => v.kind === "edge_claim"),
      false,
    );
    const qualified = checkNarrative(
      "Qualified edge on Carolina.",
      [{ ...ANALYSIS, edge: { status: "qualified" } }],
      NOW,
    );
    assert.equal(
      qualified.violations.some((v) => v.kind === "edge_claim"),
      false,
    );
  });

  void it("the reference defect: Friday/Saturday injury updates for a Thursday game", () => {
    const c = checkNarrative(
      "Second, Friday/Saturday injury updates, especially the GB questionables.",
      [ANALYSIS],
      NOW,
    );
    const days = c.violations.filter((v) => v.kind === "future_weekday").map((v) => v.excerpt);
    assert.deepEqual(days, ["Friday", "Saturday"]);
    assert.match(c.violations[0]?.detail ?? "", /allowed: Thu/);
  });

  void it("a weekday inside the window, or without report language, is fine", () => {
    const sunday = { ...ANALYSIS, timing: { phase: "pregame", weekdayEastern: "Sun" } };
    const c = checkNarrative(
      "Watch Friday's final injury report and Saturday downgrades.",
      [sunday],
      NOW,
    );
    assert.equal(c.ok, true);
    const plain = checkNarrative("They lost last Saturday.", [ANALYSIS], NOW);
    assert.equal(plain.ok, true);
  });

  void it("no pregame timing on the turn → no weekday rule", () => {
    const live = { ...ANALYSIS, timing: { phase: "live", weekdayEastern: "Thu" } };
    assert.equal(checkNarrative("Friday updates.", [live], NOW).ok, true);
  });

  void it("allowedWeekdays runs forward from now to the kickoff, inclusive", () => {
    assert.deepEqual([...allowedWeekdays("Thu", "Thu")], ["Thu"]);
    assert.deepEqual([...allowedWeekdays("Thu", "Sun")], ["Thu", "Fri", "Sat", "Sun"]);
    assert.deepEqual([...allowedWeekdays("Sat", "Mon")], ["Sat", "Sun", "Mon"]);
  });

  void it("caveatLine names each unverified claim", () => {
    const c = checkNarrative("Green Bay 47%; Carolina value; Friday updates.", [ANALYSIS], NOW);
    const line = caveatLine(c);
    assert.match(line, /3 claims could not be verified/);
    assert.match(line, /47% \(not in this turn's data\)/);
    assert.match(line, /"value" \(no qualified edge on this turn\)/);
    assert.match(line, /Friday \(after kickoff\)/);
  });
});
