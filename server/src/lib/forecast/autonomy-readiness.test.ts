import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rec } from "./fixture.ts";
import { autonomyReadiness } from "./autonomy-readiness.ts";
import { scoreRecords } from "./scoring.ts";
import type { AutonomyRules } from "./autonomy-config.ts";

const rules: AutonomyRules = {
  version: "test.1",
  writtenOn: "2026-10-24",
  minSettledPerBand: 2,
  minSettledPerLeague: 3,
  maxCalibrationErrorBps: 1500,
  mustBeatReferenceBrier: true,
  capStepsUsdc: [25, 50],
};

void describe("autonomyReadiness", () => {
  void it("reports every rule with counts; nothing passes on an empty ledger", () => {
    const r = autonomyReadiness(scoreRecords([]), {}, rules);
    assert.equal(r.passing, false);
    assert.equal(r.rules.length, 4);
    assert.ok(r.rules.every((s) => !s.passing));
    assert.equal(r.nextCapUsdc, null);
  });

  void it("passes when bands and leagues are full, calibration is inside the bound and the agent beats the reference", () => {
    // Four 70% calls, three right (hit 75%, off by 5 points); reference says 50% every time.
    const rows = [1, 1, 1, 0].map((y, i) =>
      rec({ id: `r${String(i)}`, agentBps: 7000, referenceBookBps: 5000, outcome: y as 0 | 1 }),
    );
    const all = scoreRecords(rows);
    const r = autonomyReadiness(all, { nfl: all }, rules, 25);
    assert.deepEqual(
      r.rules.map((s) => s.passing),
      [true, true, true, true],
    );
    assert.equal(r.passing, true);
    assert.equal(r.nextCapUsdc, 50, "one step above the current cap");
  });

  void it("a thin band or a league short of the minimum fails that rule only", () => {
    const rows = [rec({ id: "a", agentBps: 7000, referenceBookBps: 5000, outcome: 1 })];
    const all = scoreRecords(rows);
    const r = autonomyReadiness(all, { nfl: all }, rules);
    assert.equal(r.rules[0]?.passing, false);
    assert.match(r.rules[0]?.detail ?? "", /70–80% \(1\)/);
    assert.equal(r.rules[1]?.passing, false);
    assert.equal(r.rules[3]?.passing, true, "the agent still beats the reference");
    assert.equal(r.passing, false);
  });
});
