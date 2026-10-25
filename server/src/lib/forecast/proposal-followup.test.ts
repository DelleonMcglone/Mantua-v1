import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planRejected, planUnfilled } from "./proposal-followup.ts";

const T0 = Date.parse("2026-10-24T20:00:00Z");
const TTL = 10 * 60_000;
const row = (
  id: string,
  action: string,
  atMs: number,
  session = "s1",
  side: 0 | 1 = 0,
  event = "401",
) => ({
  id,
  sessionId: session,
  providerEventId: event,
  outcomeIndex: side,
  action,
  createdAt: new Date(atMs),
});

void describe("proposal follow-ups", () => {
  void it("a 'no' rejects the session's open proposals, not ones already filled, rejected or from another session", () => {
    const rows = [
      row("p1", "proposed", T0 - 60_000),
      row("p2", "proposed", T0 - 120_000, "s1", 1),
      row("f2", "filled", T0 - 30_000, "s1", 1),
      row("p3", "proposed", T0 - 60_000, "s2"),
      row("p4", "proposed", T0 - TTL - 1),
    ];
    assert.deepEqual(
      planRejected(rows, "s1", T0, TTL).map((r) => r.id),
      ["p1"],
    );
  });

  void it("the sweep marks proposals past the preview lifetime with no decision, once", () => {
    const rows = [
      row("p1", "proposed", T0 - TTL - 1),
      row("p2", "proposed", T0 - TTL - 1, "s1", 1),
      row("r2", "rejected_by_user", T0 - TTL, "s1", 1),
      row("p3", "proposed", T0 - TTL - 1, "s3"),
      row("u3", "unfilled", T0 - 1, "s3"),
      row("fresh", "proposed", T0 - 1),
    ];
    assert.deepEqual(
      planUnfilled(rows, T0, TTL).map((r) => r.id),
      ["p1"],
    );
  });
});
