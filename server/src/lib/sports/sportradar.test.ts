import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SportradarProvider,
  mapInjuryStatus,
  mapRosterStatus,
  mapSportradarStatus,
  parseSeasonPointer,
  parseSportradarGame,
  parseSportradarHierarchy,
  parseSportradarInjuries,
  parseSportradarRoster,
  parseSportradarSchedule,
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

const SCHEDULE = {
  id: "cc4f66f4-491b-4c36-9d4d-5c5f2d7d0cd1",
  year: 2026,
  type: "REG",
  name: "REG",
  weeks: [{ id: "w-1", sequence: 2, title: "2", games: [GAME] }],
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

  void it("walks weeks[].games[] and skips a malformed game without losing the slate", () => {
    const withBad = {
      ...SCHEDULE,
      weeks: [{ ...SCHEDULE.weeks[0], games: [GAME, { id: "no-date" }, 17] }],
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
});
