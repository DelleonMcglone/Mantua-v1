import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hitlReport, median } from "./hitl.ts";

const T = Date.parse("2026-10-24T17:00:00Z");
const row = (event: string, action: string, atMs: number, session = "s1") => ({
  sessionId: session,
  providerEventId: event,
  outcomeIndex: 0,
  action,
  createdAt: new Date(atMs),
});

void describe("hitlReport", () => {
  void it("approval rate and median times from proposal → decision pairs", () => {
    const r = hitlReport([
      row("a", "proposed", T),
      row("a", "filled", T + 30_000),
      row("b", "proposed", T),
      row("b", "filled", T + 90_000),
      row("c", "proposed", T),
      row("c", "rejected_by_user", T + 10_000),
      row("d", "proposed", T),
      row("d", "unfilled", T + 900_000),
      row("e", "proposed", T),
    ]);
    assert.equal(r.proposals, 5);
    assert.equal(r.approved, 2);
    assert.equal(r.rejected, 1);
    assert.equal(r.unfilled, 1);
    assert.equal(r.pending, 1);
    assert.ok(Math.abs((r.approvalRate ?? 0) - 2 / 3) < 1e-9);
    assert.equal(r.medianTimeToApproveMs, 60_000);
    assert.equal(r.medianTimeToRejectMs, 10_000);
  });

  void it("median of odd, even and empty lists", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), null);
  });
});
