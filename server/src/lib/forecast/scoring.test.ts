import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rec } from "./fixture.ts";
import { calibrationBins, scoreRecords } from "./scoring.ts";

/**
 * Hand-checked: r1 says 70% (ref 60%, closed 65%) and wins; r2 says 30%
 * (ref 40%, closed 45%) and loses; r3 says 75% with no reference and loses.
 * Agent Brier = (0.09 + 0.09 + 0.5625) / 3 = 0.2475; log loss =
 * (0.356675 + 0.356675 + 1.386294) / 3 = 0.699881. Reference over r1, r2:
 * Brier 0.16, log loss 0.510826. Bins: 70–80% holds r1 and r3 (mean 72.5%,
 * right 50%); 30–40% holds r2 (mean 30%, right 0%). Calibration error =
 * (2 × 2250 + 1 × 3000) / 3 = 2500 bps. CLV: r1 toward, r2 away, mean 0.
 */
const fixture = [
  rec({ id: "r1", agentBps: 7000, referenceBookBps: 6000, closingBps: 6500, outcome: 1 }),
  rec({ id: "r2", agentBps: 3000, referenceBookBps: 4000, closingBps: 4500, outcome: 0 }),
  rec({ id: "r3", agentBps: 7500, referenceBookBps: null, outcome: 0 }),
  // Excluded from scoring:
  rec({ id: "r4", agentBps: 9000, outcome: 0, afterKickoff: true }),
  rec({ id: "r5", agentBps: 9000, outcome: null, voided: true }),
  rec({ id: "r6", agentBps: 9000, outcome: null }),
];

void describe("scoreRecords", () => {
  const m = scoreRecords(fixture);

  void it("scores only settled, pre-kickoff, non-void records", () => {
    assert.equal(m.n, 3);
  });

  void it("Brier and log loss match the hand calculation, for the agent and the reference", () => {
    assert.equal(m.agent.n, 3);
    assert.ok(Math.abs((m.agent.brier ?? 0) - 0.2475) < 1e-9);
    assert.ok(Math.abs((m.agent.logLoss ?? 0) - 0.699881) < 1e-5);
    assert.equal(m.reference.n, 2);
    assert.ok(Math.abs((m.reference.brier ?? 0) - 0.16) < 1e-9);
    assert.ok(Math.abs((m.reference.logLoss ?? 0) - 0.510826) < 1e-5);
  });

  void it("ten calibration bins: count, mean predicted and hit rate", () => {
    assert.equal(m.bins.length, 10);
    assert.deepEqual(m.bins[7], {
      fromBps: 7000,
      count: 2,
      meanPredictedBps: 7250,
      hitRateBps: 5000,
    });
    assert.deepEqual(m.bins[3], { fromBps: 3000, count: 1, meanPredictedBps: 3000, hitRateBps: 0 });
    assert.deepEqual(m.bins[0], { fromBps: 0, count: 0, meanPredictedBps: null, hitRateBps: null });
    assert.equal(m.calibrationErrorBps, 2500);
  });

  void it("closing line value: toward when the close moved the agent's way", () => {
    assert.deepEqual(m.closingLineValue, {
      n: 2,
      towardAgent: 1,
      awayFromAgent: 1,
      meanMoveTowardAgentBps: 0,
    });
  });

  void it("an empty set scores as null, never NaN", () => {
    const e = scoreRecords([]);
    assert.equal(e.agent.brier, null);
    assert.equal(e.reference.logLoss, null);
    assert.equal(e.calibrationErrorBps, null);
    assert.equal(e.closingLineValue.meanMoveTowardAgentBps, null);
  });

  void it("a 100% forecast lands in the top bin", () => {
    const bins = calibrationBins([rec({ id: "x", agentBps: 10_000, outcome: 1 })]);
    assert.equal(bins[9]?.count, 1);
  });
});
