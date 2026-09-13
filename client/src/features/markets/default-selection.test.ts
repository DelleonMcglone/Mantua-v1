import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultSelection } from "./default-selection.ts";
import type { SlateEvent } from "./use-slate.ts";

const KC = { key: "nfl:KC", name: "Kansas City Chiefs", abbreviation: "KC" };
const LV = { key: "nfl:LV", name: "Las Vegas Raiders", abbreviation: "LV" };
const BUF = { key: "nfl:BUF", name: "Buffalo Bills", abbreviation: "BUF" };
const NYJ = { key: "nfl:NYJ", name: "New York Jets", abbreviation: "NYJ" };

const FINAL: SlateEvent = {
  providerEventId: "1",
  startsAt: 1,
  status: "final",
  home: BUF,
  away: NYJ,
};
const QUIET: SlateEvent = {
  providerEventId: "2",
  startsAt: 2,
  status: "scheduled",
  home: BUF,
  away: NYJ,
};
const LIVE: SlateEvent = {
  providerEventId: "3",
  startsAt: 3,
  status: "scheduled",
  home: LV,
  away: KC,
  liveOdds: true,
};

test("a deep-linked game wins, with its side", () => {
  const s = defaultSelection([FINAL, QUIET, LIVE], { initialEventId: "2", initialSide: 1 });
  assert.ok(s);
  assert.equal(s.event.providerEventId, "2");
  assert.equal(s.outcomeIndex, 1);
});

test("a deep-linked team resolves to its game and side", () => {
  const s = defaultSelection([FINAL, QUIET, LIVE], { initialTeam: "chiefs" });
  assert.ok(s);
  assert.equal(s.event.providerEventId, "3");
  assert.equal(s.outcomeIndex, 1);
});

test("otherwise the first tradeable game with a live pool, then any tradeable, then the first", () => {
  assert.equal(defaultSelection([FINAL, QUIET, LIVE], {})?.event.providerEventId, "3");
  assert.equal(defaultSelection([FINAL, QUIET], {})?.event.providerEventId, "2");
  assert.equal(defaultSelection([FINAL], {})?.event.providerEventId, "1");
  assert.equal(defaultSelection([], {}), null);
});
