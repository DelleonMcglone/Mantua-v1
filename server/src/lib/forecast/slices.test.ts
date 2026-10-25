import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rec } from "./fixture.ts";
import { horizonBucket, liquidityBucket, sliceReport, uniqueViews } from "./slices.ts";

const h = 3_600_000;
const K = Date.parse("2026-10-25T17:00:00Z");

void describe("slices", () => {
  void it("all forecasts and trades only produce separate numbers from the same ledger", () => {
    const rows = [
      // Scanned and passed: 70%, won.
      rec({ id: "a", source: "scan", agentBps: 7000, outcome: 1 }),
      // Scanned and passed: 70%, lost.
      rec({ id: "b", source: "scan", agentBps: 7000, outcome: 0 }),
      // Proposed, then filled: 80%, won — the fill repeats the proposal's view.
      rec({ id: "c", source: "proposal", action: "proposed", agentBps: 8000, outcome: 1 }),
      rec({
        id: "c-fill",
        providerEventId: "c",
        source: "proposal",
        action: "filled",
        agentBps: 8000,
        outcome: 1,
        createdAt: new Date("2026-10-24T17:05:00Z"),
      }),
    ];
    const r = sliceReport(rows);
    assert.equal(r.all.n, 3, "a, b and the proposal c — the fill is the same view");
    assert.equal(r.tradesOnly.n, 1);
    assert.ok(Math.abs((r.all.agent.brier ?? 0) - (0.09 + 0.49 + 0.04) / 3) < 1e-9);
    assert.ok(Math.abs((r.tradesOnly.agent.brier ?? 0) - 0.04) < 1e-9);
    assert.equal(r.proposed.n, 1);
    assert.equal(r.notProposed.n, 2);
  });

  void it("a fill with no proposal row (autonomous) still counts once as a view", () => {
    const views = uniqueViews([
      rec({ id: "x", source: "proposal", action: "filled" }),
      rec({ id: "y", source: "proposal", action: "proposed" }),
      rec({ id: "y-rej", providerEventId: "y", action: "rejected_by_user" }),
      rec({ id: "y-unf", providerEventId: "y", action: "unfilled" }),
    ]);
    assert.deepEqual(
      views.map((v) => v.id),
      ["x", "y"],
    );
  });

  void it("buckets horizon and liquidity", () => {
    const at = (msBefore: number) => ({
      eventStartsAt: new Date(K),
      createdAt: new Date(K - msBefore),
    });
    assert.equal(horizonBucket(at(h)), "<2h");
    assert.equal(horizonBucket(at(2 * h)), "2-24h");
    assert.equal(horizonBucket(at(24 * h)), "24-72h");
    assert.equal(horizonBucket(at(72 * h)), "72h+");
    assert.equal(liquidityBucket(null), "no_market");
    assert.equal(liquidityBucket(10), "thin");
    assert.equal(liquidityBucket(100), "shallow");
    assert.equal(liquidityBucket(500), "medium");
    assert.equal(liquidityBucket(5000), "deep");
  });

  void it("slices by league, confidence and model version", () => {
    const r = sliceReport([
      rec({ id: "a", league: "nfl", confidence: "high", modelVersion: "v1" }),
      rec({ id: "b", league: "nfl", confidence: "low", modelVersion: "v2" }),
    ]);
    assert.deepEqual(Object.keys(r.byLeague), ["nfl"]);
    assert.equal(r.byLeague["nfl"].n, 2);
    assert.deepEqual(Object.keys(r.byConfidence), ["high", "low"]);
    assert.deepEqual(Object.keys(r.byModelVersion), ["v1", "v2"]);
  });
});
