import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { injuryReportNote, kickoffContext, phaseOf } from "./kickoff-context.ts";

// Reference case: Carolina at Green Bay, 2026-10-30 00:15 UTC = Thu 2026-10-29 20:15 EDT.
const GB = new Date("2026-10-30T00:15:00Z");

void describe("kickoffContext (Goal 1 — temporal correctness)", () => {
  void it("the reference case: a Thursday game 70 minutes out, in Eastern calendar terms", () => {
    const c = kickoffContext(GB, new Date("2026-10-29T23:05:00Z"), "scheduled");
    assert.equal(c.kickoffEastern, "Thu 2026-10-29 20:15 EDT");
    assert.equal(c.weekdayEastern, "Thu");
    assert.equal(c.hoursToKickoff, 1.2);
    assert.equal(c.phase, "pregame");
    assert.match(c.injuryReportNote, /Inside 90 minutes/);
    assert.match(c.rule, /after this kickoff/);
  });

  void it("UTC date rollover: the kickoff is Friday in UTC but Thursday where the game is played", () => {
    const c = kickoffContext(GB, new Date("2026-10-28T12:00:00Z"), "scheduled");
    assert.equal(c.kickoffUtc, "2026-10-30T00:15:00.000Z");
    assert.equal(c.weekdayEastern, "Thu");
    assert.match(c.injuryReportNote, /Thursday game: the final injury report was Wednesday/);
    assert.doesNotMatch(c.injuryReportNote, /Friday|Saturday/);
  });

  void it("daylight-saving transition: a game after the clocks change prints EST, not EDT", () => {
    // 2026-11-02 01:15 UTC = Sun 2026-11-01 20:15 EST (DST ended 02:00 that morning).
    const c = kickoffContext(
      new Date("2026-11-02T01:15:00Z"),
      new Date("2026-10-30T12:00:00Z"),
      "scheduled",
    );
    assert.equal(c.kickoffEastern, "Sun 2026-11-01 20:15 EST");
    assert.match(c.injuryReportNote, /Sunday game/);
  });

  void it("phase follows authoritative status first, then the clock", () => {
    assert.equal(phaseOf("in_progress", 2), "live");
    assert.equal(phaseOf("final", -5), "final");
    assert.equal(phaseOf("postponed", 10), "postponed");
    assert.equal(phaseOf("scheduled", 0.5), "pregame");
    // Kickoff passed but the feed still says scheduled (delayed kickoff): treat as live, not pregame.
    assert.equal(phaseOf("scheduled", -0.3), "live");
  });

  void it("a game already underway gets no injury-report guidance", () => {
    const c = kickoffContext(GB, new Date("2026-10-30T01:03:00Z"), "in_progress");
    assert.equal(c.phase, "live");
    assert.equal(c.hoursToKickoff, -0.8);
    assert.match(c.injuryReportNote, /no longer apply/);
  });

  void it("the calendar note by weekday", () => {
    assert.match(injuryReportNote("Mon", 30, "pregame"), /Saturday/);
    assert.match(injuryReportNote("Sat", 30, "pregame"), /Thursday or Friday/);
    assert.match(injuryReportNote("Sun", 30, "pregame"), /final designations Friday/);
  });
});
