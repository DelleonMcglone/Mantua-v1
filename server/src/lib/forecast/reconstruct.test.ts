import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  factsAt,
  finalsBefore,
  reconstructSeason,
  scoreReconstruction,
  sideFactsAt,
  type GameRow,
} from "./reconstruct.ts";

const DAY = 86_400_000;
const T0 = Date.parse("2026-09-10T00:00:00Z");

function g(
  id: string,
  day: number,
  home: string,
  away: string,
  hs: number,
  as: number,
  final = true,
): GameRow {
  return { id, startsAt: T0 + day * DAY, home, away, homeScore: hs, awayScore: as, final };
}

// A: beat B at home (day 0), lost at C (day 7). B: lost at A, beat C at home (day 7).
// Day 14: A hosts B again. Day 21 (future): A at B, final but AFTER the target.
const SEASON: GameRow[] = [
  g("1", 0, "A", "B", 24, 10),
  g("2", 7, "C", "A", 20, 17),
  g("3", 7, "B", "C", 30, 3),
  g("4", 14, "A", "B", 0, 0, false),
  g("5", 21, "B", "A", 31, 0),
];

void describe("reconstruct — what a pregame view may see", () => {
  void it("finalsBefore excludes the game itself, later games and non-finals", () => {
    const target = SEASON[3];
    const ids = finalsBefore(SEASON, target.startsAt).map((x) => x.id);
    assert.deepEqual(ids, ["2", "3", "1"]); // newest first; 4 (not final) and 5 (later) absent
  });

  void it("sideFactsAt builds record and newest-first form from prior finals only", () => {
    const prior = finalsBefore(SEASON, SEASON[3].startsAt);
    const a = sideFactsAt(prior, "A");
    assert.deepEqual(a.record, { wins: 1, losses: 1, ties: 0 });
    assert.deepEqual(a.recentForm, ["L", "W"]);
    assert.deepEqual(a.injuries, []);
    assert.equal(sideFactsAt(prior, "Z").record, null);
  });

  void it("factsAt is the home side with this season's prior meetings as head-to-head", () => {
    const f = factsAt(SEASON, SEASON[3]);
    assert.equal(f.side, "home");
    assert.equal(f.team.name, "A");
    assert.deepEqual(f.headToHead, { teamWins: 1, opponentWins: 0, ties: 0 });
    assert.equal(f.live, null);
    assert.equal(f.marketImpliedBps, null);
  });

  void it("the later blowout (game 5) never leaks into game 4's view", () => {
    const withLeak = factsAt(SEASON, SEASON[3]);
    const without = factsAt(
      SEASON.filter((x) => x.id !== "5"),
      SEASON[3],
    );
    assert.deepEqual(withLeak, without);
  });

  void it("reconstructSeason labels outcomes and leaves unplayed and tied games unscored", () => {
    const rows = reconstructSeason([...SEASON, g("6", 28, "C", "B", 14, 14)]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get("1")?.outcome, 1);
    assert.equal(byId.get("2")?.outcome, 1);
    assert.equal(byId.get("4")?.outcome, null);
    assert.equal(byId.get("5")?.outcome, 1);
    assert.equal(byId.get("6")?.outcome, null);
    // Week-1 views have no records: venue only.
    assert.equal(byId.get("1")?.homeProbabilityBps, 5250);
  });

  void it("scoreReconstruction: Brier, log loss, coin-flip scale and favourite hit rate", () => {
    const s = scoreReconstruction([
      {
        id: "x",
        week: null,
        startsAt: 0,
        home: "A",
        away: "B",
        homeProbabilityBps: 7000,
        outcome: 1,
      },
      {
        id: "y",
        week: null,
        startsAt: 0,
        home: "A",
        away: "B",
        homeProbabilityBps: 7000,
        outcome: 0,
      },
      {
        id: "z",
        week: null,
        startsAt: 0,
        home: "A",
        away: "B",
        homeProbabilityBps: 5000,
        outcome: 1,
      },
      {
        id: "w",
        week: null,
        startsAt: 0,
        home: "A",
        away: "B",
        homeProbabilityBps: 6000,
        outcome: null,
      },
    ]);
    assert.equal(s.n, 3);
    // (0.09 + 0.49 + 0.25) / 3
    assert.ok(Math.abs((s.brier ?? 0) - 0.276667) < 1e-6);
    assert.ok(Math.abs((s.logLoss ?? 0) - (0.356675 + 1.203973 + 0.693147) / 3) < 1e-6);
    assert.equal(s.coinFlipBrier, 0.25);
    assert.equal(s.favouriteHitRate, 0.5);
    assert.equal(scoreReconstruction([]).brier, null);
  });
});

void describe("reconstruct — point differential facts (slice 3)", () => {
  void it("sideFactsAt sums points for and against over prior finals", () => {
    const prior = finalsBefore(SEASON, SEASON[3].startsAt);
    // A: 24-10 at home, 17-20 away → 41 for, 30 against, 2 games.
    assert.deepEqual(sideFactsAt(prior, "A").margin, {
      pointsFor: 41,
      pointsAgainst: 30,
      games: 2,
    });
    assert.equal(sideFactsAt(prior, "Z").margin, null);
  });

  void it("reconstructSeason passes weight overrides through to the estimator", () => {
    const off = reconstructSeason(SEASON);
    const on = reconstructSeason(SEASON, { marginBpsPerPoint: 200 });
    const g4off = off.find((r) => r.id === "4");
    const g4on = on.find((r) => r.id === "4");
    assert.ok(g4off && g4on);
    assert.notEqual(g4on.homeProbabilityBps, g4off.homeProbabilityBps);
  });
});
