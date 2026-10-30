import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MIN_SETTLED_FOR_EDGE, qualifyEdge, type EdgeInput } from "./edge-qualification.ts";

const good: EdgeInput = {
  probabilityBps: 5117,
  poolBps: 4400,
  poolAgeSeconds: 60,
  liquidityUsdc: 2500,
  bookBps: 6164,
  calibration: { modelVersion: "v", settled: 40, agentBrier: 0.2, referenceBrier: 0.21 },
  thresholdBps: 500,
  feeBps: 100,
};

void describe("qualifyEdge (Goal 4 — discrepancy is not edge)", () => {
  void it("no Mantua market: nothing executable, the book gap is a candidate discrepancy only", () => {
    const e = qualifyEdge({ ...good, poolBps: null });
    assert.equal(e.status, "no_market");
    assert.equal(e.gapVsPoolBps, null);
    assert.equal(e.gapVsBookBps, 5117 - 6164);
    assert.match(e.summary, /no Mantua trade can be executed/);
    assert.match(e.summary, /candidate discrepancy/);
  });

  void it("inside the threshold: none", () => {
    const e = qualifyEdge({ ...good, poolBps: 5000 });
    assert.equal(e.status, "none");
    assert.deepEqual(e.blockers, []);
  });

  void it("qualified only when the price is fresh, the pool deep, the model calibrated and the fee covered", () => {
    const e = qualifyEdge(good);
    assert.equal(e.status, "qualified");
    assert.equal(e.gapVsPoolBps, 717);
    assert.match(e.summary, /^Qualified/);
    assert.match(e.summary, /simulator and the user's confirm/);
  });

  void it("stale price → candidate", () => {
    const e = qualifyEdge({ ...good, poolAgeSeconds: 20 * 60 });
    assert.equal(e.status, "candidate");
    assert.match(e.blockers.join("|"), /stale/);
    assert.match(e.summary, /Do not call this value/);
  });

  void it("thin or unknown liquidity → candidate", () => {
    assert.equal(qualifyEdge({ ...good, liquidityUsdc: 100 }).status, "candidate");
    assert.equal(qualifyEdge({ ...good, liquidityUsdc: null }).status, "candidate");
  });

  void it("uncalibrated forecast → candidate, naming the sample it needs", () => {
    const e = qualifyEdge({ ...good, calibration: null });
    assert.equal(e.status, "candidate");
    assert.match(e.blockers.join("|"), new RegExp(`needs ${String(MIN_SETTLED_FOR_EDGE)}`));
    const few = qualifyEdge({
      ...good,
      calibration: { modelVersion: "v", settled: 10, agentBrier: 0.2, referenceBrier: 0.21 },
    });
    assert.match(few.blockers.join("|"), /10 settled records/);
  });

  void it("a calibrated model that loses to the reference → candidate", () => {
    const e = qualifyEdge({
      ...good,
      calibration: { modelVersion: "v", settled: 50, agentBrier: 0.25, referenceBrier: 0.21 },
    });
    assert.equal(e.status, "candidate");
    assert.match(e.blockers.join("|"), /has not beaten the reference/);
  });

  void it("a gap that does not cover the fee → candidate; the rich side reads as rich", () => {
    const e = qualifyEdge({ ...good, poolBps: 5717, feeBps: 700 });
    assert.equal(e.status, "candidate");
    assert.match(e.blockers.join("|"), /cover the fee/);
    assert.match(e.summary, /600 bps rich/);
  });

  void it("the sportsbook gap never qualifies anything on its own", () => {
    const e = qualifyEdge({ ...good, poolBps: 5100, bookBps: 7000 });
    assert.equal(e.status, "none");
    assert.equal(e.gapVsBookBps, -1883);
  });
});
