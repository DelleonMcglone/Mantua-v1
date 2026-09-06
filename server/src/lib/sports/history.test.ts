/**
 * 038 / S-008 — the pure history computations over seeded fixture rows.
 *
 * Style matches strategy-engine.test.ts: the DB never appears — fixtures
 * are the plain row shapes the fetch wrappers produce, and the pure
 * `compute*`/reader functions are exercised directly. The load-bearing
 * assertions are the insufficient-data paths: an empty canonical table
 * must yield an explicit refusal, never zeros or fabricated records.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeHeadToHead,
  computeHomeAwaySplits,
  computeSituationalTrends,
  playerSeasonStats,
  summarizeTeamGames,
  teamSeasonStats,
  type FinishedGameRow,
} from "./history.ts";

const DAY = 86_400_000;
const T0 = new Date("2026-09-01T00:00:00Z");

/** Fixture builder — newest-first ordering is the caller's duty, as with
 *  the real fetchers (ORDER BY starts_at DESC). */
function game(
  daysAgo: number,
  home: string,
  away: string,
  homeScore: number | null,
  awayScore: number | null,
  overrides: Partial<FinishedGameRow> = {},
): FinishedGameRow {
  return {
    providerEventId: `evt-${home}-${away}-${String(daysAgo)}`,
    startsAt: new Date(T0.getTime() - daysAgo * DAY),
    homeTeamKey: home,
    awayTeamKey: away,
    homeTeam: home.toUpperCase(),
    awayTeam: away.toUpperCase(),
    homeScore,
    awayScore,
    ...overrides,
  };
}

void describe("summarizeTeamGames", () => {
  void it("summarizes from the team's perspective on both sides of the ball", () => {
    const rows = [
      game(1, "kc", "lv", 27, 20), // kc home win
      game(8, "den", "kc", 14, 31), // kc away win
      game(15, "kc", "buf", 17, 24), // kc home loss
    ];
    const games = summarizeTeamGames("kc", rows);
    assert.equal(games.length, 3);
    assert.deepEqual(
      games.map((g) => [g.homeAway, g.result, g.margin]),
      [
        ["home", "W", 7],
        ["away", "W", 17],
        ["home", "L", -7],
      ],
    );
    assert.equal(games[1].opponentKey, "den");
    assert.equal(games[1].teamScore, 31);
  });

  void it("drops games without both scores — a scheduled game is not history", () => {
    const rows = [game(0, "kc", "lv", null, null), game(1, "kc", "lv", 27, null)];
    assert.deepEqual(summarizeTeamGames("kc", rows), []);
  });

  void it("drops games not involving the team", () => {
    const rows = [game(1, "buf", "mia", 30, 10)];
    assert.deepEqual(summarizeTeamGames("kc", rows), []);
  });

  void it("scores a tie as T with zero margin", () => {
    const [g] = summarizeTeamGames("kc", [game(1, "kc", "lv", 20, 20)]);
    assert.equal(g.result, "T");
    assert.equal(g.margin, 0);
  });
});

void describe("computeHeadToHead", () => {
  void it("computes the record between exactly the two teams", () => {
    const rows = [
      game(1, "kc", "lv", 27, 20), // kc W
      game(30, "lv", "kc", 24, 21), // lv W
      game(60, "kc", "lv", 17, 17), // tie
      game(5, "kc", "buf", 40, 3), // not a meeting — must be ignored
    ];
    const result = computeHeadToHead("kc", "lv", rows);
    assert.ok(result.ok);
    assert.equal(result.data.aWins, 1);
    assert.equal(result.data.bWins, 1);
    assert.equal(result.data.ties, 1);
    assert.equal(result.data.games.length, 3);
    assert.equal(result.data.lastMeetingAt, Math.floor((T0.getTime() - DAY) / 1000));
  });

  void it("returns insufficient_data when the teams never met — no fabrication", () => {
    const result = computeHeadToHead("kc", "lv", [game(1, "kc", "buf", 20, 10)]);
    assert.ok(!result.ok);
    assert.equal(result.reason, "insufficient_data");
    assert.match(result.detail, /no completed meetings/);
  });
});

void describe("computeHomeAwaySplits", () => {
  void it("splits the record and points by venue", () => {
    const rows = [
      game(1, "kc", "lv", 27, 20), // home W
      game(8, "kc", "buf", 10, 24), // home L
      game(15, "den", "kc", 14, 31), // away W
    ];
    const result = computeHomeAwaySplits("kc", rows);
    assert.ok(result.ok);
    assert.deepEqual(result.data.home, {
      games: 2,
      wins: 1,
      losses: 1,
      ties: 0,
      pointsFor: 37,
      pointsAgainst: 44,
    });
    assert.deepEqual(result.data.away, {
      games: 1,
      wins: 1,
      losses: 0,
      ties: 0,
      pointsFor: 31,
      pointsAgainst: 14,
    });
  });

  void it("returns insufficient_data with no completed games", () => {
    const result = computeHomeAwaySplits("kc", [game(0, "kc", "lv", null, null)]);
    assert.ok(!result.ok);
  });
});

void describe("computeSituationalTrends", () => {
  void it("derives form, streak, and margin from newest-first rows", () => {
    const rows = [
      game(1, "kc", "lv", 27, 20), // W
      game(8, "kc", "buf", 30, 20), // W
      game(15, "den", "kc", 24, 10), // L (kc away)
      game(22, "kc", "mia", 21, 14), // W
    ];
    const result = computeSituationalTrends("kc", rows, 3);
    assert.ok(result.ok);
    assert.deepEqual(result.data.recentForm, ["W", "W", "L"]);
    assert.deepEqual(result.data.currentStreak, { kind: "W", count: 2 });
    // margins: +7, +10, -14, +7 → avg 2.5
    assert.equal(result.data.avgMargin, 2.5);
  });

  void it("splits favorite/underdog off Mantua's opening line only where one exists", () => {
    const rows = [
      // kc home, opening home prob .65 → kc favorite, won
      game(1, "kc", "lv", 27, 20, { homeOpeningProbability: "0.65000" }),
      // kc away, opening home prob .60 → kc underdog (.40), lost
      game(8, "den", "kc", 24, 10, { homeOpeningProbability: "0.60000" }),
      // no market minted → contributes to neither split
      game(15, "kc", "mia", 21, 14, { homeOpeningProbability: null }),
    ];
    const result = computeSituationalTrends("kc", rows);
    assert.ok(result.ok);
    assert.deepEqual(result.data.asFavorite, {
      games: 1,
      wins: 1,
      losses: 0,
      ties: 0,
      pointsFor: 27,
      pointsAgainst: 20,
    });
    assert.deepEqual(result.data.asUnderdog, {
      games: 1,
      wins: 0,
      losses: 1,
      ties: 0,
      pointsFor: 10,
      pointsAgainst: 24,
    });
  });

  void it("reports null favorite/underdog splits when no game carried a line", () => {
    const result = computeSituationalTrends("kc", [game(1, "kc", "lv", 27, 20)]);
    assert.ok(result.ok);
    assert.equal(result.data.asFavorite, null);
    assert.equal(result.data.asUnderdog, null);
  });

  void it("returns insufficient_data with no completed games", () => {
    const result = computeSituationalTrends("kc", []);
    assert.ok(!result.ok);
    assert.match(result.detail, /no completed games/);
  });
});

void describe("season-stat jsonb readers", () => {
  void it("reads a player's season out of the keyed jsonb", () => {
    const stats = playerSeasonStats(
      { "2026": { passingYards: 3120, touchdowns: 24 }, "2025": { passingYards: 4100 } },
      "2026",
    );
    assert.deepEqual(stats, { passingYards: 3120, touchdowns: 24 });
  });

  void it("returns null — not zeros — for an absent season or empty stats", () => {
    assert.equal(playerSeasonStats({ "2025": { yards: 1 } }, "2026"), null);
    assert.equal(playerSeasonStats({}, "2026"), null);
    assert.equal(playerSeasonStats({ "2026": {} }, "2026"), null);
  });

  void it("drops non-numeric entries and nulls out a stat map with none left", () => {
    assert.deepEqual(teamSeasonStats({ pointsPerGame: 24.5, note: "hot streak" }), {
      pointsPerGame: 24.5,
    });
    assert.equal(teamSeasonStats({ note: "strings only" }), null);
    assert.equal(teamSeasonStats(null), null);
  });
});
