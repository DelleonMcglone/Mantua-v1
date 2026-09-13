/**
 * Phase 12 — chart annotations come only from data the layer holds:
 * period labels per league, the freeze and the resolution, a capped
 * injury list, all sorted by time.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { annotationsFor, periodLabel } from "./market-depth-annotations.ts";
import type { DepthEvent, InjuryRow } from "./market-depth-read.ts";

const NOW = 1_789_500_000;
const EVENT: DepthEvent = {
  id: "ev1",
  league: "nfl",
  providerEventId: "401547401",
  startsAt: NOW - 3600,
  status: "final",
  homeScore: 10,
  awayScore: 14,
  home: { teamId: "t-lv", key: "nfl:LV", abbreviation: "LV" },
  away: { teamId: "t-kc", key: "nfl:KC", abbreviation: "KC" },
};
const INJURY: InjuryRow = {
  at: NOW - 86_400,
  teamId: "t-kc",
  player: "Chris Jones",
  status: "questionable",
  description: "calf",
};

void describe("periodLabel", () => {
  void it("labels quarters, the second half, and overtime; other leagues by period", () => {
    assert.equal(periodLabel("nfl", 2), "Q2");
    assert.equal(periodLabel("nfl", 3), "2nd half");
    assert.equal(periodLabel("nfl", 5), "OT");
    assert.equal(periodLabel("nfl", 6), "OT2");
    assert.equal(periodLabel("mlb", 7), "Period 7");
    assert.equal(periodLabel(null, 2), "Period 2");
  });
});

void describe("annotationsFor", () => {
  void it("marks kickoff, period starts after the first, the freeze and the resolution", () => {
    const out = annotationsFor({
      event: EVENT,
      market: { marketId: "m", outcomeIndex: 0, frozenAt: NOW - 100, resolvedAt: NOW - 50 },
      periods: [
        { period: 1, at: NOW - 3500 },
        { period: 3, at: NOW - 1200 },
      ],
      injuries: [],
      nowSec: NOW,
    });
    assert.deepEqual(
      out.map((a) => `${a.kind}:${a.label}`),
      ["kickoff:Kickoff", "period:2nd half", "frozen:Trading closed", "resolved:Resolved"],
    );
  });

  void it("names the team and player on an injury and caps the list", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...INJURY, at: NOW - 1000 - i }));
    const out = annotationsFor({
      event: EVENT,
      market: null,
      periods: [],
      injuries: many,
      nowSec: NOW,
    });
    const injuries = out.filter((a) => a.kind === "injury");
    assert.equal(injuries.length, 6);
    assert.equal(injuries[0]?.label, "KC: Chris Jones questionable");
    for (let i = 1; i < out.length; i += 1) assert.ok((out[i]?.t ?? 0) >= (out[i - 1]?.t ?? 0));
  });

  void it("omits kickoff for a game that has not started", () => {
    const out = annotationsFor({
      event: { ...EVENT, status: "scheduled", startsAt: NOW + 60 },
      market: null,
      periods: [],
      injuries: [],
      nowSec: NOW,
    });
    assert.deepEqual(out, []);
  });
});
