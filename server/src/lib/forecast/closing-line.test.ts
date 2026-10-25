import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CLOSING_GRACE_S, CLOSING_LEAD_S, closingCandidates } from "./closing-line.ts";

const NOW = 1_800_000_000; // seconds
const ev = (id: string, startsAt: number, status = "scheduled") => ({
  providerEventId: id,
  startsAt,
  status,
  homeWinProbabilityBps: 6000,
});

void describe("closingCandidates", () => {
  void it("takes the last pre-kickoff tick and a just-started game, nothing further out or over", () => {
    const picked = closingCandidates(
      [
        ev("far", NOW + 3600),
        ev("soon", NOW + CLOSING_LEAD_S),
        ev("now", NOW),
        ev("started", NOW - CLOSING_GRACE_S, "in_progress"),
        ev("long-ago", NOW - CLOSING_GRACE_S - 1, "in_progress"),
        ev("done", NOW - 60, "final"),
      ],
      NOW * 1000,
    );
    assert.deepEqual(
      picked.map((e) => e.providerEventId),
      ["soon", "now", "started"],
    );
  });
});
