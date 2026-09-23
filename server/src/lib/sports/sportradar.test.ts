import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  mapSeasonType,
  SportradarProvider,
  mapInjuryStatus,
  mapRosterStatus,
  mapSportradarStatus,
  nextSeasonWeek,
  parseSeasonPointer,
  parseSportradarGame,
  parseSportradarHierarchy,
  parseSportradarInjuries,
  parseSportradarPlays,
  parseSportradarRoster,
  parseSportradarSchedule,
  parseSportradarStandings,
  politeFetch,
} from "./sportradar.ts";

// ─── Fixtures ───────────────────────────────────────────────────────────────
// Built from the shapes the official reference pages document (URLs in
// sportradar.ts header). Field names are verbatim from the docs; values are
// invented.

const GAME = {
  id: "5a7042cb-fe7a-4838-b93f-6b8c167ec384",
  status: "closed",
  scheduled: "2026-09-13T17:00:00+00:00",
  home: { id: "82d2d380-3834-4938-835f-aec541e5ece7", name: "Kansas City Chiefs", alias: "KC" },
  away: { id: "7d4fcc64-9cb5-4d1b-8e75-8a906d1e1576", name: "Las Vegas Raiders", alias: "LV" },
  scoring: { home_points: 27, away_points: 20, periods: [] },
};

// Shape verified against a live call (2026-09-22): `week` is a single
// object, not a `weeks` array — see parseSportradarSchedule's doc comment
// in sportradar.ts for why the original (wrong) fixture shipped undetected.
const SCHEDULE = {
  id: "cc4f66f4-491b-4c36-9d4d-5c5f2d7d0cd1",
  year: 2026,
  type: "REG",
  name: "REG",
  week: { id: "w-1", sequence: 2, title: "2", games: [GAME] },
};

const HIERARCHY = {
  league: { id: "lg", name: "National Football League", alias: "NFL" },
  conferences: [
    {
      id: "afc",
      name: "AFC",
      divisions: [
        {
          id: "afc-west",
          name: "AFC West",
          teams: [
            {
              id: "82d2d380-3834-4938-835f-aec541e5ece7",
              name: "Chiefs",
              market: "Kansas City",
              alias: "KC",
            },
            {
              id: "7d4fcc64-9cb5-4d1b-8e75-8a906d1e1576",
              name: "Raiders",
              market: "Las Vegas",
              alias: "LV",
            },
          ],
        },
      ],
    },
  ],
};

const ROSTER = {
  id: "82d2d380-3834-4938-835f-aec541e5ece7",
  name: "Chiefs",
  market: "Kansas City",
  alias: "KC",
  players: [
    {
      id: "11cad59b-2dae-4d1d-a9b4-4f4f9d0f4a6d",
      name: "Pat Sample",
      position: "QB",
      jersey: "15",
      status: "ACT",
    },
    {
      id: "22cad59b-2dae-4d1d-a9b4-4f4f9d0f4a6e",
      name: "Ret Ired",
      position: "TE",
      jersey: "87",
      status: "RET",
    },
    { name: "No Id Given" }, // malformed — must be skipped, never guessed
  ],
};

const INJURIES = {
  season: { id: "s", year: 2026, type: "REG" },
  week: { id: "w", sequence: 2, title: "2" },
  teams: [
    {
      id: "82d2d380-3834-4938-835f-aec541e5ece7",
      alias: "KC",
      players: [
        {
          id: "11cad59b-2dae-4d1d-a9b4-4f4f9d0f4a6d",
          name: "Pat Sample",
          jersey: "15",
          position: "QB",
          injuries: [
            {
              id: "i-old",
              status: "Questionable",
              status_date: "2026-09-08T18:00:00+00:00",
              primary: "Hamstring",
              practice: { status: "Limited Participation In Practice" },
            },
            {
              id: "i-new",
              status: "Out",
              status_date: "2026-09-11T18:00:00+00:00",
              primary: "Hamstring",
              practice: { status: "Did Not Participate In Practice" },
            },
          ],
        },
        {
          id: "33cad59b-2dae-4d1d-a9b4-4f4f9d0f4a6f",
          name: "Unknown Status",
          injuries: [{ id: "i-x", status: "Mysterious", primary: "Unknown" }],
        },
      ],
    },
  ],
};

// Task 041 — pbp shape per nfl-play-by-play: periods[] → pbp[] (drives with
// events[]) → play objects; sequence is an epoch-ms-scale ordering number.
const PBP = {
  id: GAME.id,
  status: "inprogress",
  quarter: 2,
  clock: "12:34",
  periods: [
    {
      period_type: "quarter",
      number: 1,
      sequence: 1,
      pbp: [
        {
          type: "drive",
          id: "drive-1",
          events: [
            {
              type: "play",
              id: "play-1",
              sequence: 1698611000000,
              clock: "15:00",
              play_type: "kickoff",
              description: "L.Kicker kicks 65 yards from LV 35 to the end zone, touchback.",
              home_points: 0,
              away_points: 0,
              wall_clock: "2026-09-13T17:01:33+00:00",
              start_situation: {
                possession: { id: "t-lv", name: "Raiders", market: "Las Vegas", alias: "LV" },
              },
              end_situation: {
                possession: { id: "t-kc", name: "Chiefs", market: "Kansas City", alias: "KC" },
              },
            },
            {
              type: "event", // a non-play pbp event (e.g. a comment) — skipped
              id: "ev-1",
              sequence: 1698611010000,
              description: "Officials review the spot.",
            },
            {
              type: "play",
              id: "play-2",
              sequence: 1698611137531,
              clock: "12:34",
              play_type: "pass",
              scoring_play: true,
              description: "P.Sample passes deep left, TOUCHDOWN.",
              home_points: 7,
              away_points: 0,
              start_situation: {
                possession: { id: "t-kc", name: "Chiefs", market: "Kansas City", alias: "KC" },
              },
              end_situation: {
                possession: { id: "t-lv", name: "Raiders", market: "Las Vegas", alias: "LV" },
              },
            },
            { type: "play", id: "play-broken" }, // no sequence — skipped, never guessed
          ],
        },
      ],
    },
  ],
};

// Task 041 — standings shape per nfl-postgame-standings: season{year,type} +
// conferences[].divisions[].teams[] with rank/streak objects and a records[]
// array of categorised splits (home / road / …).
const STANDINGS = {
  season: { id: "s-2026", year: 2026, type: "REG", name: "REG" },
  conferences: [
    {
      id: "afc",
      name: "AFC",
      divisions: [
        {
          id: "afc-west",
          name: "AFC West",
          teams: [
            {
              id: "82d2d380-3834-4938-835f-aec541e5ece7",
              name: "Chiefs",
              market: "Kansas City",
              alias: "KC",
              sr_id: "sr:competitor:4422",
              wins: 11,
              losses: 6,
              ties: 0,
              win_pct: 0.647,
              points_for: 410,
              points_against: 333,
              rank: { division: 1, conference: 3, clinched: "division" },
              streak: { type: "win", length: 3, desc: "W3" },
              records: [
                { category: "home", wins: 6, losses: 2, ties: 0, win_pct: 0.75 },
                { category: "road", wins: 5, losses: 4, ties: 0, win_pct: 0.556 },
                { category: "division", wins: 4, losses: 2, ties: 0, win_pct: 0.667 },
              ],
            },
            {
              id: "7d4fcc64-9cb5-4d1b-8e75-8a906d1e1576",
              name: "Raiders",
              market: "Las Vegas",
              alias: "LV",
              wins: 7,
              losses: 9,
              ties: 1,
              win_pct: 0.441,
              points_for: 301,
              points_against: 355,
              rank: { division: 3, conference: 12 },
              streak: { type: "loss", length: 2, desc: "L2" },
              records: [
                { category: "home", wins: 4, losses: 4, ties: 1 },
                { category: "road", wins: 3, losses: 5, ties: 0 },
              ],
            },
            { name: "No Id Or Record" }, // malformed — skipped, never guessed
          ],
        },
      ],
    },
  ],
};

// ─── Status mappings ────────────────────────────────────────────────────────

void describe("mapSportradarStatus (S-003)", () => {
  void it("maps the documented statuses onto the provider vocabulary", () => {
    assert.equal(mapSportradarStatus("scheduled"), "scheduled");
    assert.equal(mapSportradarStatus("created"), "scheduled");
    assert.equal(mapSportradarStatus("time-tbd"), "scheduled");
    assert.equal(mapSportradarStatus("inprogress"), "in_progress");
    assert.equal(mapSportradarStatus("closed"), "final");
    assert.equal(mapSportradarStatus("cancelled"), "cancelled");
    assert.equal(mapSportradarStatus("postponed"), "postponed");
    assert.equal(mapSportradarStatus("suspended"), "postponed");
    assert.equal(mapSportradarStatus("unnecessary"), "cancelled");
  });

  void it("maps `complete` to in_progress, NOT final — only a confirmed score settles", () => {
    // Sportradar: complete = game ended, closed = score confirmed. Mapping
    // complete → final would let an unconfirmed score resolve a market.
    assert.equal(mapSportradarStatus("complete"), "in_progress");
  });

  void it("never guesses an unrecognised status", () => {
    assert.equal(mapSportradarStatus("weird-new-status"), "unknown");
    assert.equal(mapSportradarStatus(undefined), "unknown");
    assert.equal(mapSportradarStatus(42), "unknown");
  });
});

void describe("mapRosterStatus / mapInjuryStatus", () => {
  void it("collapses roster codes conservatively", () => {
    assert.equal(mapRosterStatus("ACT"), "active");
    assert.equal(mapRosterStatus("RET"), "retired");
    for (const code of ["IR", "PUP", "SUS", "UDF", "NWT"]) {
      assert.equal(mapRosterStatus(code), "inactive");
    }
  });

  void it("maps documented injury designations and skips the rest", () => {
    assert.equal(mapInjuryStatus("Out"), "out");
    assert.equal(mapInjuryStatus("Doubtful"), "doubtful");
    assert.equal(mapInjuryStatus("Questionable"), "questionable");
    assert.equal(mapInjuryStatus("Something Novel"), null);
  });
});

// ─── Parsers against documented shapes ──────────────────────────────────────

void describe("parseSportradarGame / parseSportradarSchedule", () => {
  void it("normalizes a schedule game to a ProviderEvent", () => {
    const e = parseSportradarGame(GAME, "nfl");
    assert.equal(e.providerEventId, GAME.id);
    assert.equal(e.league, "nfl");
    assert.equal(e.status, "final");
    assert.equal(e.startsAt, Math.floor(Date.parse(GAME.scheduled) / 1000));
    assert.equal(e.home.key, "nfl:KC");
    assert.equal(e.home.name, "Kansas City Chiefs");
    assert.equal(e.away.key, "nfl:LV");
    assert.equal(e.homeScore, 27);
    assert.equal(e.awayScore, 20);
    // NFL v7 publishes no win probability — pools seed at the 50/50 default.
    assert.equal(e.homeWinProbabilityBps, undefined);
  });

  void it("produces the same team keys as the ESPN adapter would (B3-004)", () => {
    // Cross-provider corroboration hangs on this property.
    const e = parseSportradarGame(GAME, "nfl");
    assert.equal(e.home.key, "nfl:KC");
  });

  void it("walks week.games[] and skips a malformed game without losing the slate", () => {
    const withBad = {
      ...SCHEDULE,
      week: { ...SCHEDULE.week, games: [GAME, { id: "no-date" }, 17] },
    };
    const events = parseSportradarSchedule(withBad, "nfl");
    assert.equal(events.length, 1);
  });

  void it("extracts the season pointer the injuries path needs", () => {
    assert.deepEqual(parseSeasonPointer(SCHEDULE), { year: 2026, type: "REG", week: 2 });
    assert.equal(parseSeasonPointer({}), null);
  });
});

void describe("parseSportradarHierarchy / parseSportradarRoster", () => {
  void it("flattens conferences → divisions → teams and composes market + name", () => {
    const teams = parseSportradarHierarchy(HIERARCHY, "nfl");
    assert.equal(teams.length, 2);
    assert.equal(teams[0].name, "Kansas City Chiefs");
    assert.equal(teams[0].key, "nfl:KC");
    assert.equal(teams[0].providerId, "82d2d380-3834-4938-835f-aec541e5ece7");
  });

  void it("normalizes roster players and skips entries with no id", () => {
    const players = parseSportradarRoster(ROSTER, "nfl");
    assert.equal(players.length, 2);
    assert.deepEqual(players[0], {
      providerPlayerId: "11cad59b-2dae-4d1d-a9b4-4f4f9d0f4a6d",
      name: "Pat Sample",
      teamKey: "nfl:KC",
      position: "QB",
      jerseyNumber: 15,
      status: "active",
    });
    assert.equal(players[1].status, "retired");
  });
});

void describe("parseSportradarInjuries", () => {
  void it("keeps one report per player — the latest by status_date", () => {
    const reports = parseSportradarInjuries(INJURIES, "nfl");
    assert.equal(reports.length, 1);
    assert.deepEqual(reports[0], {
      providerPlayerId: "11cad59b-2dae-4d1d-a9b4-4f4f9d0f4a6d",
      playerName: "Pat Sample",
      teamKey: "nfl:KC",
      status: "out",
      description: "Hamstring",
      providerUpdatedAt: Math.floor(Date.parse("2026-09-11T18:00:00+00:00") / 1000),
    });
  });

  void it("drops reports whose designation it does not recognise", () => {
    const reports = parseSportradarInjuries(INJURIES, "nfl");
    assert.ok(!reports.some((r) => r.playerName === "Unknown Status"));
  });
});

// ─── Task 041 parsers: play-by-play + standings ─────────────────────────────

void describe("parseSportradarPlays (041 / S-005)", () => {
  void it("walks periods → pbp drives → events and keeps only typed plays with a sequence", () => {
    const plays = parseSportradarPlays(PBP, "nfl");
    assert.equal(plays.length, 2); // the non-play event and the broken play drop
    assert.deepEqual(plays[0], {
      sequence: 1698611000000,
      period: 1,
      clock: "15:00",
      playType: "kickoff",
      description: "L.Kicker kicks 65 yards from LV 35 to the end zone, touchback.",
      teamKey: "nfl:LV",
      scoringPlay: false,
      homeScore: 0,
      awayScore: 0,
      detail: { possessionAfter: "nfl:KC", wallClock: "2026-09-13T17:01:33+00:00" },
    });
  });

  void it("keeps the epoch-ms-scale sequence verbatim — it is the append cursor", () => {
    const plays = parseSportradarPlays(PBP, "nfl");
    assert.equal(plays[1].sequence, 1698611137531);
    assert.ok(
      plays[1].sequence > 2 ** 31,
      "sequence exceeds int4 — the 0015 bigint migration exists for this",
    );
  });

  void it("marks scoring plays and derives possession keys from the documented aliases", () => {
    const [, td] = parseSportradarPlays(PBP, "nfl");
    assert.equal(td.scoringPlay, true);
    assert.equal(td.teamKey, "nfl:KC"); // possession at the play's start
    assert.equal(td.detail?.["possessionAfter"], "nfl:LV"); // ball after the play
    assert.deepEqual([td.homeScore, td.awayScore], [7, 0]);
  });

  void it("refuses a payload without a periods array", () => {
    assert.throws(() => parseSportradarPlays({ nope: true }, "nfl"), /periods/);
  });
});

void describe("parseSportradarStandings (041 / S-006)", () => {
  void it("flattens conferences → divisions → teams with ranks, streaks, and splits", () => {
    const lines = parseSportradarStandings(STANDINGS, "nfl");
    assert.equal(lines.length, 2); // the malformed team drops
    const kc = lines[0];
    assert.equal(kc.teamKey, "nfl:KC");
    assert.equal(kc.season, "2026");
    assert.equal(kc.seasonType, "regular");
    assert.deepEqual([kc.wins, kc.losses, kc.ties], [11, 6, 0]);
    assert.equal(kc.divisionRank, 1);
    assert.equal(kc.conferenceRank, 3);
    assert.deepEqual([kc.pointsFor, kc.pointsAgainst], [410, 333]);
    assert.equal(kc.streak, "W3");
    assert.equal(kc.homeRecord, "6-2");
    assert.equal(kc.awayRecord, "5-4"); // Sportradar's away category is "road"
  });

  void it("lands win_pct and every categorised split in the stats aggregate map", () => {
    const [kc] = parseSportradarStandings(STANDINGS, "nfl");
    assert.equal(kc.stats["win_pct"], 0.647);
    assert.equal(kc.stats["home_wins"], 6);
    assert.equal(kc.stats["road_win_pct"], 0.556);
    assert.equal(kc.stats["division_wins"], 4);
  });

  void it("composes a tie-carrying record string and a streak from type+length when desc is odd", () => {
    const [, lv] = parseSportradarStandings(STANDINGS, "nfl");
    assert.equal(lv.homeRecord, "4-4-1");
    assert.equal(lv.streak, "L2");
  });

  void it("refuses a payload without season/conferences", () => {
    assert.throws(() => parseSportradarStandings({ conferences: [] }, "nfl"), /season/);
  });
});

// ─── Polite transport ───────────────────────────────────────────────────────

void describe("politeFetch (trial-quota manners)", () => {
  void it("injects the x-api-key header per the auth docs", async () => {
    let seen: Headers | undefined;
    const fetchImpl = ((_url: unknown, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    const polite = politeFetch("test-key", 0, fetchImpl);
    await polite("https://api.sportradar.com/x");
    assert.equal(seen?.get("x-api-key"), "test-key");
  });

  void it("spaces consecutive requests by the minimum interval", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const fetchImpl = (() =>
      Promise.resolve(new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    const polite = politeFetch(
      "k",
      1_100,
      fetchImpl,
      () => clock,
      (ms) => {
        sleeps.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    );
    await polite("https://a");
    await polite("https://b");
    await polite("https://c");
    // First request goes immediately; each later one waits out the spacing.
    assert.deepEqual(sleeps, [1_100, 1_100]);
  });

  void it("opens a cooldown honoring Retry-After on a 429", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    let call = 0;
    const fetchImpl = (() => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? new Response("slow down", { status: 429, headers: { "retry-after": "7" } })
          : new Response("{}", { status: 200 }),
      );
    }) as unknown as typeof fetch;
    const polite = politeFetch(
      "k",
      1_000,
      fetchImpl,
      () => clock,
      (ms) => {
        sleeps.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    );
    const first = await polite("https://a");
    assert.equal(first.status, 429);
    await polite("https://b");
    // The second request waited the full Retry-After (7s), not just 1s.
    assert.deepEqual(sleeps, [7_000]);
  });
});

// ─── The adapter over a fake upstream ───────────────────────────────────────

function fakeUpstream(routes: Record<string, unknown>): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = ((url: unknown) => {
    const u = String(url);
    calls.push(u);
    for (const [suffix, payload] of Object.entries(routes)) {
      if (u.includes(suffix)) {
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function provider(routes: Record<string, unknown>): {
  p: SportradarProvider;
  calls: string[];
} {
  const { fetchImpl, calls } = fakeUpstream(routes);
  // production access level: no artificial pacing delays in tests.
  const p = new SportradarProvider({ apiKey: "k", accessLevel: "production", fetchImpl });
  return { p, calls };
}

void describe("SportradarProvider", () => {
  void it("serves the slate from /games/current_week/schedule.json", async () => {
    const { p, calls } = provider({ "/games/current_week/schedule.json": SCHEDULE });
    const slate = await p.getSlate("nfl");
    assert.equal(slate.provider, "sportradar");
    assert.equal(slate.delayed, false);
    assert.equal(slate.events.length, 1);
    assert.ok(calls[0].includes("/nfl/official/production/v7/en/games/current_week/schedule.json"));
  });

  void it("caches per feed TTL — a second read costs no upstream call", async () => {
    const { p, calls } = provider({ "/games/current_week/schedule.json": SCHEDULE });
    await p.getSlate("nfl");
    await p.getSlate("nfl");
    assert.equal(calls.length, 1);
  });

  void it("fetches next week's schedule off the current week's pointer (REG 2 → REG 3)", async () => {
    const WEEK_3 = {
      ...SCHEDULE,
      week: {
        id: "w-3",
        sequence: 3,
        title: "3",
        games: [{ ...GAME, id: "next-week-game", status: "scheduled", scoring: undefined }],
      },
    };
    const { p, calls } = provider({
      "/games/current_week/schedule.json": SCHEDULE,
      "/games/2026/REG/3/schedule.json": WEEK_3,
    });
    await p.getSlate("nfl");
    const next = await p.getNextSlate("nfl");
    assert.ok(next);
    assert.deepEqual(
      next.events.map((e) => e.providerEventId),
      ["next-week-game"],
    );
    // The current-week read is shared with getSlate's cache: one call each.
    assert.equal(calls.length, 2);
    assert.ok(calls[1].includes("/nfl/official/production/v7/en/games/2026/REG/3/schedule.json"));
  });

  void it("returns null after the Super Bowl without a second upstream call", async () => {
    const { p, calls } = provider({
      "/games/current_week/schedule.json": {
        ...SCHEDULE,
        type: "PST",
        week: { ...SCHEDULE.week, sequence: 4 },
      },
    });
    assert.equal(await p.getNextSlate("nfl"), null);
    assert.equal(calls.length, 1);
  });

  void it("reads one game from the boxscore feed", async () => {
    const { p, calls } = provider({ [`/games/${GAME.id}/boxscore.json`]: GAME });
    const e = await p.getEvent("nfl", GAME.id);
    assert.ok(e);
    assert.equal(e.status, "final");
    assert.equal(e.homeScore, 27);
    assert.ok(calls[0].includes(`/games/${GAME.id}/boxscore.json`));
  });

  void it("resolves the current week before fetching injuries", async () => {
    const { p, calls } = provider({
      "/games/current_week/schedule.json": SCHEDULE,
      "/seasons/2026/REG/2/injuries.json": INJURIES,
    });
    const feed = await p.getInjuries("nfl");
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].status, "out");
    assert.ok(calls.some((u) => u.includes("/seasons/2026/REG/2/injuries.json")));
  });

  void it("exposes teams and rosters through the optional capabilities", async () => {
    const { p } = provider({
      "/league/hierarchy.json": HIERARCHY,
      [`/teams/${ROSTER.id}/full_roster.json`]: ROSTER,
    });
    const teams = await p.getTeams("nfl");
    assert.equal(teams.items.length, 2);
    const roster = await p.getRoster("nfl", ROSTER.id);
    assert.equal(roster.items.length, 2);
    assert.equal(roster.items[0].teamKey, "nfl:KC");
  });

  void it("refuses leagues outside the licensed package instead of guessing", async () => {
    const { p } = provider({});
    await assert.rejects(() => p.getSlate("wnba"));
  });

  void it("serves play-by-play from /games/{id}/pbp.json (041)", async () => {
    const { p, calls } = provider({ [`/games/${GAME.id}/pbp.json`]: PBP });
    const feed = await p.getPlayByPlay("nfl", GAME.id);
    assert.equal(feed.provider, "sportradar");
    assert.equal(feed.items.length, 2);
    assert.ok(calls[0].includes(`/games/${GAME.id}/pbp.json`));
  });

  void it("resolves the season pointer before fetching standings (041)", async () => {
    const { p, calls } = provider({
      "/games/current_week/schedule.json": SCHEDULE,
      "/seasons/2026/REG/standings/season.json": STANDINGS,
    });
    const feed = await p.getStandings("nfl");
    assert.equal(feed.items.length, 2);
    assert.equal(feed.items[0].teamKey, "nfl:KC");
    assert.ok(calls.some((u) => u.includes("/seasons/2026/REG/standings/season.json")));
  });
});

// ─── Task 049 / D-105 — season type rides every scheduled game ──────────────

void describe("season type on schedule games (D-105)", () => {
  void it("stamps the schedule root's type onto each game", () => {
    const [game] = parseSportradarSchedule(SCHEDULE, "nfl");
    assert.equal(game.seasonType, "regular");
    const playoffs = { ...SCHEDULE, type: "PST" };
    assert.equal(parseSportradarSchedule(playoffs, "nfl")[0]?.seasonType, "postseason");
    const pre = { ...SCHEDULE, type: "PRE" };
    assert.equal(parseSportradarSchedule(pre, "nfl")[0]?.seasonType, "preseason");
  });

  void it("omits the field when the root type is unrecognised — never guesses", () => {
    const odd = { ...SCHEDULE, type: "XYZ" };
    assert.equal("seasonType" in (parseSportradarSchedule(odd, "nfl")[0] ?? {}), false);
    assert.equal(mapSeasonType("pst"), "postseason", "case-insensitive");
    assert.equal(mapSeasonType(3), null, "numbers are ESPN's convention, not Sportradar's");
  });
});

void describe("nextSeasonWeek", () => {
  void it("walks the NFL calendar without guessing weeks that don't exist", () => {
    const at = (type: string, week: number) => nextSeasonWeek({ year: 2026, type, week });
    assert.deepEqual(at("PRE", 0), { year: 2026, type: "PRE", week: 1 });
    assert.deepEqual(at("PRE", 3), { year: 2026, type: "REG", week: 1 });
    assert.deepEqual(at("REG", 2), { year: 2026, type: "REG", week: 3 });
    assert.deepEqual(at("REG", 18), { year: 2026, type: "PST", week: 1 });
    assert.deepEqual(at("PST", 3), { year: 2026, type: "PST", week: 4 });
    assert.equal(at("PST", 4), null);
    assert.equal(at("???", 1), null);
  });
});
