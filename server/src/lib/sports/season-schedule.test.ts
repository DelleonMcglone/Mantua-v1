import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env["NODE_ENV"] ??= "test";
process.env["DATABASE_URL"] ??= "postgres://localhost:5432/mantua";
process.env["PRIVY_APP_ID"] ??= "test";
process.env["PRIVY_APP_SECRET"] ??= "test";

const { beyondSlate, fetchSeasonSchedule, SLATE_OWNED_SECONDS } =
  await import("./season-schedule.ts");
const { hasScore, seasonWindow, teamMatches } = await import("./schedule-read.ts");

const NOW = 1_790_900_000;
const event = (id: string, startsAt: number) => ({
  id,
  date: new Date(startsAt * 1000).toISOString(),
  status: { type: { state: "pre" } },
  competitions: [
    {
      competitors: [
        {
          homeAway: "home",
          team: { id: "5", abbreviation: "CLE", displayName: "Cleveland Browns" },
        },
        {
          homeAway: "away",
          team: { id: "23", abbreviation: "PIT", displayName: "Pittsburgh Steelers" },
        },
      ],
    },
  ],
});

void describe("fetchSeasonSchedule", () => {
  void it("asks for every regular-season and postseason week and merges by game id", async () => {
    const urls: string[] = [];
    const games = await fetchSeasonSchedule((url) => {
      urls.push(url);
      const week = Number(/week=(\d+)/.exec(url)?.[1]);
      const type = Number(/seasontype=(\d)/.exec(url)?.[1]);
      // one game per regular-season week; week 2's game is repeated in week 3
      const events = type === 2 ? [event(String(week === 3 ? 2 : week), NOW + week * 604_800)] : [];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ events }) });
    });
    assert.equal(urls.length, 23);
    assert.ok(urls.some((u) => u.includes("seasontype=2&week=18")));
    assert.ok(urls.some((u) => u.includes("seasontype=3&week=5")));
    assert.equal(games.length, 17);
  });
  void it("skips a week that fails instead of failing the season", async () => {
    const games = await fetchSeasonSchedule((url) =>
      url.includes("week=4")
        ? Promise.reject(new Error("timeout"))
        : Promise.resolve({
            ok: !url.includes("week=5"),
            json: () => Promise.resolve({ events: [] }),
          }),
    );
    assert.deepEqual(games, []);
  });
});

void describe("beyondSlate", () => {
  void it("leaves games the slate sync owns alone and keeps the rest of the season", () => {
    const soon = { providerEventId: "soon", startsAt: NOW + 86_400 };
    const edge = { providerEventId: "edge", startsAt: NOW + SLATE_OWNED_SECONDS };
    const later = { providerEventId: "later", startsAt: NOW + SLATE_OWNED_SECONDS + 1 };
    const kept = beyondSlate([soon, edge, later] as never, NOW);
    assert.deepEqual(
      kept.map((e) => e.providerEventId),
      ["later"],
    );
  });
});

void describe("schedule reads", () => {
  const game = {
    homeTeam: "Cleveland Browns",
    awayTeam: "Pittsburgh Steelers",
    homeTeamKey: "nfl:CLE",
    awayTeamKey: "nfl:PIT",
  };
  void it("matches a team by city, nickname or abbreviation", () => {
    for (const q of ["Cleveland", "browns", "CLE", "Steelers", "pit", "nfl:PIT", ""]) {
      assert.equal(teamMatches(game, q), true, q);
    }
    assert.equal(teamMatches(game, "Ravens"), false);
    assert.equal(teamMatches(game, "BAL"), false);
  });
  void it("reports a score only for a game that has started", () => {
    assert.equal(hasScore("scheduled"), false);
    assert.equal(hasScore("postponed"), false);
    assert.equal(hasScore("in_progress"), true);
    assert.equal(hasScore("final"), true);
  });
  void it("the season runs August to the end of February, whichever side of New Year", () => {
    const oct = seasonWindow(new Date("2026-10-02T12:00:00Z"));
    assert.equal(oct.from.toISOString().slice(0, 10), "2026-08-01");
    assert.equal(oct.to.toISOString().slice(0, 10), "2027-03-01");
    const jan = seasonWindow(new Date("2027-01-15T12:00:00Z"));
    assert.equal(jan.from.toISOString().slice(0, 10), "2026-08-01");
  });
});
