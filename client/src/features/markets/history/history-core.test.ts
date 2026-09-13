import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { HistoryRow } from "../detail/depth-types.ts";
import { filterHistory, historyRowView, sparklinePoints } from "./history-core.ts";

function row(over: Partial<HistoryRow> = {}): HistoryRow {
  return {
    league: "nfl",
    providerEventId: "401547401",
    home: { key: "nfl:LV", name: "Las Vegas Raiders", abbreviation: "LV" },
    away: { key: "nfl:KC", name: "Kansas City Chiefs", abbreviation: "KC" },
    startsAt: Date.UTC(2026, 8, 7, 20) / 1000,
    homeScore: 17,
    awayScore: 24,
    state: "RESOLVED",
    resolvedAt: 1,
    outcome: { winningOutcomeIndex: 1, method: "auto", label: "Kansas City Chiefs won" },
    settlementPriceBps: 0,
    path: [
      { t: 0, priceBps: 5000 },
      { t: 50, priceBps: 4000 },
      { t: 100, priceBps: 100 },
    ],
    ...over,
  };
}

test("a resolved row reads title, score, outcome, settlement, and the closing price", () => {
  const v = historyRowView(row());
  assert.equal(v.title, "Kansas City Chiefs at Las Vegas Raiders");
  assert.equal(v.finalScore, "KC 24 · LV 17");
  assert.equal(v.outcome, "Kansas City Chiefs won");
  assert.equal(v.settlement, "Las Vegas Raiders contracts paid $0.00");
  assert.equal(v.closingPrice, "1¢");
  assert.equal(v.tone, "away");
  assert.match(v.date, /2026/);
});

test("home wins, voids, and pending rows carry their own tone and settlement", () => {
  const home = historyRowView(
    row({
      outcome: { winningOutcomeIndex: 0, method: "auto", label: "x" },
      settlementPriceBps: 10_000,
    }),
  );
  assert.equal(home.tone, "home");
  assert.equal(home.settlement, "Las Vegas Raiders contracts paid $1.00");
  const voided = historyRowView(
    row({
      outcome: { winningOutcomeIndex: null, method: "void", label: "Voided" },
      settlementPriceBps: 5000,
    }),
  );
  assert.equal(voided.tone, "void");
  assert.equal(voided.settlement, "Both sides settled at 50¢");
  const pending = historyRowView(
    row({
      outcome: { winningOutcomeIndex: null, method: null, label: "Awaiting" },
      settlementPriceBps: null,
      path: [],
      homeScore: null,
    }),
  );
  assert.equal(pending.tone, "pending");
  assert.equal(pending.settlement, null);
  assert.equal(pending.closingPrice, null);
  assert.equal(pending.finalScore, null);
});

test("sparkline points scale time to width and price to height; short paths draw nothing", () => {
  assert.equal(sparklinePoints(row().path, 100, 40), "0.0,20.0 50.0,24.0 100.0,39.6");
  assert.equal(sparklinePoints([{ t: 1, priceBps: 5000 }], 100, 40), "");
});

test("the league filter keeps everything for null and one league otherwise", () => {
  const rows = [row(), row({ league: "wnba", providerEventId: "2" })];
  assert.equal(filterHistory(rows, null).length, 2);
  assert.deepEqual(
    filterHistory(rows, "wnba").map((r) => r.providerEventId),
    ["2"],
  );
});
