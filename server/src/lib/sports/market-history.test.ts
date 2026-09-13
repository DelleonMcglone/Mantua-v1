/**
 * Phase 12 — history rows carry an honest outcome label, the settlement
 * price the contract paid, and a bounded path that keeps its ends.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PATH_POINTS, samplePath, toHistoryRow, type HistoryRowInput } from "./market-history.ts";

const KC = { key: "nfl:KC", name: "Kansas City Chiefs", abbreviation: "KC" };
const LV = { key: "nfl:LV", name: "Las Vegas Raiders", abbreviation: "LV" };

function input(over: Partial<HistoryRowInput> = {}): HistoryRowInput {
  return {
    league: "nfl",
    providerEventId: "401547401",
    home: LV,
    away: KC,
    startsAt: 1_789_400_000,
    homeScore: 17,
    awayScore: 24,
    state: "RESOLVED",
    resolvedAt: 1_789_420_000,
    winningOutcomeIndex: 1,
    method: "auto",
    path: [
      { t: 1, priceBps: 5000 },
      { t: 2, priceBps: 4200 },
      { t: 3, priceBps: 100 },
    ],
    ...over,
  };
}

void describe("samplePath", () => {
  void it("returns short paths untouched and samples long ones keeping both ends", () => {
    const short = [1, 2, 3];
    assert.deepEqual(samplePath(short), short);
    const long = Array.from({ length: 1000 }, (_, i) => i);
    const sampled = samplePath(long);
    assert.equal(sampled.length, PATH_POINTS);
    assert.equal(sampled[0], 0);
    assert.equal(sampled.at(-1), 999);
    for (let i = 1; i < sampled.length; i += 1) {
      assert.ok((sampled[i] ?? 0) > (sampled[i - 1] ?? 0));
    }
  });
});

void describe("toHistoryRow", () => {
  void it("labels an away win and settles the home contract at $0", () => {
    const row = toHistoryRow(input());
    assert.equal(row.outcome.label, "Kansas City Chiefs won");
    assert.equal(row.outcome.winningOutcomeIndex, 1);
    assert.equal(row.settlementPriceBps, 0);
    assert.equal(row.path.length, 3);
  });

  void it("labels a home win and settles at $1", () => {
    const row = toHistoryRow(input({ winningOutcomeIndex: 0 }));
    assert.equal(row.outcome.label, "Las Vegas Raiders won");
    assert.equal(row.settlementPriceBps, 10_000);
  });

  void it("voids settle both sides at 50¢, by method or by state", () => {
    assert.equal(
      toHistoryRow(input({ method: "void", winningOutcomeIndex: null })).settlementPriceBps,
      5000,
    );
    const invalid = toHistoryRow(
      input({ state: "INVALID", method: null, winningOutcomeIndex: null }),
    );
    assert.equal(invalid.settlementPriceBps, 5000);
    assert.match(invalid.outcome.label, /Voided/);
  });

  void it("says so when no resolution is recorded yet", () => {
    const row = toHistoryRow(input({ winningOutcomeIndex: null, method: null, resolvedAt: null }));
    assert.equal(row.outcome.label, "Awaiting resolution");
    assert.equal(row.settlementPriceBps, null);
    assert.equal(row.outcome.winningOutcomeIndex, null);
  });
});
