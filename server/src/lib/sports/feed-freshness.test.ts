import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { anyInPlay, CANONICAL_FRESH_MS, freshMsFor, QUIET_FRESH_MS } from "./feed-freshness.ts";

/** The quiet-hour rule — the 2026-10-21 "delayed for fifty minutes of every hour" lesson. */

const NOW = 1_800_000_000_000;

void describe("feed-freshness", () => {
  void it("keeps the game-time threshold with a game in play and one hourly tick otherwise", () => {
    assert.equal(freshMsFor(true), CANONICAL_FRESH_MS);
    assert.equal(freshMsFor(false), QUIET_FRESH_MS);
    assert.ok(QUIET_FRESH_MS > 60 * 60_000, "an hourly tick plus slack");
  });

  void it("in play means kicked off and not over — the trade gate's rule", () => {
    const h = 3_600_000;
    assert.equal(anyInPlay([{ startsAt: NOW + h, status: "scheduled" }], NOW), false);
    assert.equal(anyInPlay([{ startsAt: NOW - h, status: "scheduled" }], NOW), true);
    assert.equal(anyInPlay([{ startsAt: new Date(NOW - h), status: "in_progress" }], NOW), true);
    assert.equal(anyInPlay([{ startsAt: NOW - h, status: "final" }], NOW), false);
    assert.equal(anyInPlay([{ startsAt: NOW - h, status: "postponed" }], NOW), false);
    assert.equal(anyInPlay([], NOW), false);
  });
});
