import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveTeamSelection } from "./team-select.ts";

const EVENTS = [
  {
    providerEventId: "1",
    home: { key: "nfl:LV", name: "Las Vegas Raiders", abbreviation: "LV" },
    away: { key: "nfl:KC", name: "Kansas City Chiefs", abbreviation: "KC" },
  },
  {
    providerEventId: "2",
    home: { key: "nfl:BUF", name: "Buffalo Bills", abbreviation: "BUF" },
    away: { key: "nfl:NYJ", name: "New York Jets", abbreviation: "NYJ" },
  },
];

test("a team hint resolves to its game and side (T-017)", () => {
  assert.deepEqual(resolveTeamSelection(EVENTS, "chiefs"), { eventId: "1", outcomeIndex: 1 });
  assert.deepEqual(resolveTeamSelection(EVENTS, "Raiders"), { eventId: "1", outcomeIndex: 0 });
  assert.deepEqual(resolveTeamSelection(EVENTS, "kc"), { eventId: "1", outcomeIndex: 1 });
  assert.deepEqual(resolveTeamSelection(EVENTS, "new york"), { eventId: "2", outcomeIndex: 1 });
});

test("an unknown or empty hint resolves to nothing, never an error", () => {
  assert.equal(resolveTeamSelection(EVENTS, "packers"), null);
  assert.equal(resolveTeamSelection(EVENTS, "  "), null);
  assert.equal(resolveTeamSelection([], "chiefs"), null);
});
