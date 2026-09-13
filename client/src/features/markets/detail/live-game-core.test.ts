import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LiveGame } from "./depth-types.ts";
import { liveGameView, periodName } from "./live-game-core.ts";

const HOME = { key: "nfl:LV", abbreviation: "LV" };
const AWAY = { key: "nfl:KC", abbreviation: "KC" };
const GAME: LiveGame = {
  status: "in_progress",
  homeScore: 10,
  awayScore: 14,
  period: 2,
  clock: "07:12",
  possession: "nfl:KC",
  lastPlay: "Mahomes pass complete for 12 yards",
  asOf: 1_789_500_000,
};

test("a live game reads score, situation, possession, and the last play", () => {
  const v = liveGameView({ league: "nfl", game: GAME, home: HOME, away: AWAY });
  assert.deepEqual(v, {
    score: "KC 14 · LV 10",
    situation: "Q2 · 07:12",
    possession: "KC ball",
    lastPlay: "Mahomes pass complete for 12 yards",
    asOf: 1_789_500_000,
  });
});

test("missing fields stay absent instead of invented", () => {
  const v = liveGameView({
    league: "nfl",
    game: { ...GAME, period: null, clock: null, possession: "nfl:XX", lastPlay: null },
    home: HOME,
    away: AWAY,
  });
  assert.ok(v);
  assert.equal(v.situation, null);
  assert.equal(v.possession, null);
  assert.equal(v.lastPlay, null);
  const noScore = liveGameView({
    league: "nfl",
    game: { ...GAME, homeScore: null },
    home: HOME,
    away: AWAY,
  });
  assert.equal(noScore?.score, null);
});

test("only an in-progress game has a live view; periods name by league", () => {
  assert.equal(
    liveGameView({ league: "nfl", game: { ...GAME, status: "final" }, home: HOME, away: AWAY }),
    null,
  );
  assert.equal(periodName("nfl", 4), "Q4");
  assert.equal(periodName("wnba", 5), "OT");
  assert.equal(periodName("nfl", 6), "OT2");
  assert.equal(periodName("mlb", 3), "Period 3");
});
