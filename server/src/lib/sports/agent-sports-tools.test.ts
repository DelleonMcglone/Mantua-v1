import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getGame,
  getLiveGameState,
  getTeamStats,
  getPlayerStats,
  getPlayerInjuryStatus,
  getRecentGames,
  getHeadToHead,
  getStandings,
  getPlayByPlay,
  getMarketPrice,
  getMarketHistory,
  getMarketVolume,
  getMarketLiquidity,
} from "./agent-sports-tools.ts";
import type {
  EventRow,
  GamePlayRow,
  LeagueRow,
  MarketFillRow,
  MarketPriceRow,
  MarketRow,
  OpenInjuryRow,
  PlayerRow,
  SportsToolsDb,
  TeamRecordRow,
  TeamRow,
} from "./agent-sports-tools.ts";

/**
 * 039 — S-011..S-021: the sports-data tool suite over the canonical DB.
 *
 * Style: stub-env, no live database (the repo's test rule). The tools read
 * through the narrow `SportsToolsDb` seam, so these tests provide an
 * in-memory implementation over fixture rows whose filtering mirrors the
 * drizzle implementation method-for-method. Everything interesting —
 * fuzzy resolution + didYouMean, date windows, standings aggregation, the
 * honesty envelope (unavailable-vs-not_found), and the S-021 composition
 * flow — lives in the module under test.
 */

type R = Record<string, unknown>;
const asR = (v: unknown): R => v as R;
const asArr = (v: unknown): R[] => v as R[];

const NOW = new Date("2026-09-06T20:00:00Z");
const hours = (n: number): Date => new Date(NOW.getTime() + n * 3_600_000);
const days = (n: number): Date => new Date(NOW.getTime() + n * 86_400_000);

// ─── Fixtures ───────────────────────────────────────────────────────────────

interface InjuryFixture {
  id: string;
  playerId: string;
  teamId: string | null;
  status: string;
  description: string | null;
  reportedAt: Date;
  providerUpdatedAt: Date | null;
  resolvedAt: Date | null;
}

interface Fixtures {
  leagues: LeagueRow[];
  teams: TeamRow[];
  players: PlayerRow[];
  injuries: InjuryFixture[];
  events: EventRow[];
  markets: MarketRow[];
  prices: (MarketPriceRow & { marketId: string })[];
  fills: (MarketFillRow & { marketId: string })[];
  /** Task 041 — ingested tables. Absent in the base fixtures on purpose:
   *  the fallback paths are the base behavior, the preferred paths opt in. */
  plays?: (GamePlayRow & { eventId: string })[];
  teamRecords?: TeamRecordRow[];
  /** playerId → the season_stats jsonb. */
  seasonStats?: Record<string, unknown>;
}

const M0 = `0x${"a".repeat(64)}`;
const M1 = `0x${"c".repeat(64)}`;
const POOL = `0x${"b".repeat(64)}`;

function team(
  id: string,
  key: string,
  name: string,
  abbreviation: string,
  leagueId = "lg-nfl",
): TeamRow {
  return { id, leagueId, key, name, shortName: null, abbreviation };
}

function ev(
  id: string,
  home: TeamRow,
  away: TeamRow,
  startsAt: Date,
  status: string,
  homeScore: number | null = null,
  awayScore: number | null = null,
): EventRow {
  return {
    id,
    leagueId: home.leagueId,
    providerEventId: `pe-${id}`,
    homeTeam: home.name,
    awayTeam: away.name,
    homeTeamKey: home.key,
    awayTeamKey: away.key,
    homeTeamId: home.id,
    awayTeamId: away.id,
    startsAt,
    status,
    homeScore,
    awayScore,
  };
}

const ATL = team("t-atl", "nfl:ATL", "Atlanta Falcons", "ATL");
const NO = team("t-no", "nfl:NO", "New Orleans Saints", "NO");
const NYG = team("t-nyg", "nfl:NYG", "New York Giants", "NYG");
const NYJ = team("t-nyj", "nfl:NYJ", "New York Jets", "NYJ");

function fixtures(): Fixtures {
  const eLive = ev("e-live", ATL, NO, hours(-1), "in_progress", 14, 10);
  return {
    leagues: [{ id: "lg-nfl", slug: "nfl", name: "NFL" }],
    teams: [ATL, NO, NYG, NYJ],
    players: [
      {
        id: "p-qb",
        leagueId: "lg-nfl",
        teamId: "t-atl",
        name: "Kirk Prime",
        position: "QB",
        jerseyNumber: 8,
        status: "active",
      },
      {
        id: "p-wr",
        leagueId: "lg-nfl",
        teamId: "t-atl",
        name: "Dee Catchman",
        position: "WR",
        jerseyNumber: 17,
        status: "active",
      },
      {
        id: "p-smith-no",
        leagueId: "lg-nfl",
        teamId: "t-no",
        name: "Cam Smith",
        position: "CB",
        jerseyNumber: 21,
        status: "active",
      },
      {
        id: "p-smith-nyg",
        leagueId: "lg-nfl",
        teamId: "t-nyg",
        name: "Cam Smith",
        position: "S",
        jerseyNumber: 33,
        status: "active",
      },
    ],
    injuries: [
      {
        id: "i-open",
        playerId: "p-wr",
        teamId: "t-atl",
        status: "questionable",
        description: "hamstring",
        reportedAt: days(-2),
        providerUpdatedAt: days(-1),
        resolvedAt: null,
      },
      {
        id: "i-resolved",
        playerId: "p-qb",
        teamId: "t-atl",
        status: "probable",
        description: "rest",
        reportedAt: days(-20),
        providerUpdatedAt: null,
        resolvedAt: days(-15),
      },
    ],
    events: [
      eLive,
      ev("e-f1", ATL, NYG, days(-7), "final", 24, 17), // W (home)
      ev("e-f2", NO, ATL, days(-14), "final", 27, 20), // L (away)
      ev("e-f3", ATL, NO, days(-21), "final", 31, 13), // W (home)
      ev("e-f4", NYJ, ATL, days(-28), "final", 10, 21), // W (away)
      ev("e-sched", NO, ATL, days(7), "scheduled"),
    ],
    markets: [
      {
        marketId: M0,
        eventId: "e-live",
        marketType: "moneyline",
        outcomeIndex: 0,
        state: "OPEN",
        poolId: POOL,
        openingProbability: "0.62000",
      },
      {
        marketId: M1,
        eventId: "e-live",
        marketType: "moneyline",
        outcomeIndex: 1,
        state: "OPEN",
        poolId: null,
        openingProbability: "0.38000",
      },
    ],
    prices: [
      { marketId: M0, impliedProbability: "0.60000", source: "opening", liquidityRaw: null, capturedAt: hours(-2) },
      {
        marketId: M0,
        impliedProbability: "0.63000",
        source: "pool",
        liquidityRaw: "2500000000",
        capturedAt: hours(-1),
      },
      { marketId: M0, impliedProbability: "0.66000", source: "pool", liquidityRaw: null, capturedAt: hours(-0.5) },
    ],
    fills: [
      { marketId: M0, direction: "buy", tokensRaw: "150000000", usdcRaw: "100000000", createdAt: hours(-2) },
      { marketId: M0, direction: "buy", tokensRaw: "75000000", usdcRaw: "50000000", createdAt: hours(-3) },
      { marketId: M0, direction: "sell", tokensRaw: "45000000", usdcRaw: "30000000", createdAt: hours(-4) },
      { marketId: M0, direction: "buy", tokensRaw: "10000000", usdcRaw: "999000000", createdAt: hours(-48) },
    ],
  };
}

/** In-memory SportsToolsDb whose filters mirror the drizzle implementation. */
function makeFakeDb(f: Fixtures): SportsToolsDb {
  const byStartDesc = (a: EventRow, b: EventRow): number =>
    b.startsAt.getTime() - a.startsAt.getTime();
  const involvesTeam = (e: EventRow, t: TeamRow): boolean =>
    e.homeTeamId === t.id ||
    e.awayTeamId === t.id ||
    e.homeTeamKey === t.key ||
    e.awayTeamKey === t.key ||
    e.homeTeam === t.name ||
    e.awayTeam === t.name;
  const joinInjury = (i: InjuryFixture): OpenInjuryRow => {
    const p = f.players.find((x) => x.id === i.playerId) ?? null;
    return {
      id: i.id,
      playerId: i.playerId,
      teamId: i.teamId,
      status: i.status,
      description: i.description,
      reportedAt: i.reportedAt,
      providerUpdatedAt: i.providerUpdatedAt,
      playerName: p ? p.name : null,
      position: p ? p.position : null,
    };
  };
  return {
    listLeagues: () => Promise.resolve(f.leagues),
    listTeams: () => Promise.resolve(f.teams),
    listPlayers: () => Promise.resolve(f.players),
    listEventsForTeam: (t, limit) =>
      Promise.resolve(
        f.events
          .filter((e) => involvesTeam(e, t))
          .sort(byStartDesc)
          .slice(0, limit),
      ),
    listEventsForLeague: (leagueId, limit) =>
      Promise.resolve(
        f.events.filter((e) => e.leagueId === leagueId).sort(byStartDesc).slice(0, limit),
      ),
    getEventByProviderEventId: (pid) =>
      Promise.resolve(f.events.find((e) => e.providerEventId === pid) ?? null),
    hasAnyEvents: () => Promise.resolve(f.events.length > 0),
    listOpenInjuriesForTeam: (teamId) =>
      Promise.resolve(
        f.injuries
          .filter((i) => i.teamId === teamId && i.resolvedAt === null)
          .sort((a, b) => b.reportedAt.getTime() - a.reportedAt.getTime())
          .map(joinInjury),
      ),
    listOpenInjuriesForPlayer: (playerId) =>
      Promise.resolve(
        f.injuries
          .filter((i) => i.playerId === playerId && i.resolvedAt === null)
          .sort((a, b) => b.reportedAt.getTime() - a.reportedAt.getTime())
          .map(joinInjury),
      ),
    hasAnyInjuries: () => Promise.resolve(f.injuries.length > 0),
    listMarketsForEvent: (eventId) =>
      Promise.resolve(f.markets.filter((m) => m.eventId === eventId)),
    getMarket: (marketId) => Promise.resolve(f.markets.find((m) => m.marketId === marketId) ?? null),
    listMarketPrices: (marketId, limit) =>
      Promise.resolve(
        f.prices
          .filter((p) => p.marketId === marketId)
          .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
          .slice(0, limit),
      ),
    listMarketFillsSince: (marketId, since) =>
      Promise.resolve(
        f.fills
          .filter((x) => x.marketId === marketId && x.createdAt.getTime() >= since.getTime())
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
    listPlaysForEvent: (eventId, limit) =>
      Promise.resolve(
        (f.plays ?? [])
          .filter((p) => p.eventId === eventId)
          .sort((a, b) => b.sequence - a.sequence)
          .slice(0, limit),
      ),
    listTeamRecordsForTeam: (teamId) =>
      Promise.resolve((f.teamRecords ?? []).filter((r) => r.teamId === teamId)),
    listTeamRecordsForLeague: (leagueId) => {
      const teamIds = new Set(f.teams.filter((t) => t.leagueId === leagueId).map((t) => t.id));
      return Promise.resolve((f.teamRecords ?? []).filter((r) => teamIds.has(r.teamId)));
    },
    getPlayerSeasonStats: (playerId) => Promise.resolve((f.seasonStats ?? {})[playerId] ?? null),
  };
}

const db = makeFakeDb(fixtures());
const emptyDb = makeFakeDb({
  leagues: [],
  teams: [],
  players: [],
  injuries: [],
  events: [],
  markets: [],
  prices: [],
  fills: [],
});

// ─── Fuzzy resolution / did-you-mean ────────────────────────────────────────

void describe("sports tools — team/player resolution", () => {
  void it("resolves a nickname fragment to the canonical team", async () => {
    const res = asR(await getTeamStats(db, { team: "Falcons" }));
    assert.equal(res["status"], "ok");
    assert.equal(asR(res["team"])["name"], "Atlanta Falcons");
  });

  void it("returns didYouMean on an ambiguous team query — never a silent pick", async () => {
    const res = asR(await getTeamStats(db, { team: "New York" }));
    assert.equal(res["status"], "ambiguous");
    const names = asArr(res["didYouMean"]).map((c) => c["name"]);
    assert.deepEqual(names.toSorted(), ["New York Giants", "New York Jets"]);
  });

  void it("distinguishes not_found (no match) from unavailable (nothing ingested)", async () => {
    const miss = asR(await getTeamStats(db, { team: "Packers" }));
    assert.equal(miss["status"], "not_found");
    const empty = asR(await getTeamStats(emptyDb, { team: "Packers" }));
    assert.equal(empty["status"], "unavailable");
    assert.match(String(empty["reason"]), /not yet ingested/);
  });

  void it("returns didYouMean on an ambiguous player query", async () => {
    const res = asR(await getPlayerStats(db, { player: "Cam Smith" }));
    assert.equal(res["status"], "ambiguous");
    assert.equal(asArr(res["didYouMean"]).length, 2);
  });

  void it("disambiguates a player by team", async () => {
    const res = asR(await getPlayerStats(db, { player: "Cam Smith", team: "Saints" }));
    assert.equal(res["status"], "ok");
    assert.equal(asR(res["player"])["team"], "New Orleans Saints");
  });

  void it("rejects an unknown league with the known slugs", async () => {
    const res = asR(await getTeamStats(db, { team: "Falcons", league: "xfl" }));
    assert.equal(res["status"], "not_found");
    assert.deepEqual(res["knownLeagues"], ["nfl"]);
  });
});

// ─── S-011 get_game ─────────────────────────────────────────────────────────

void describe("get_game (S-011)", () => {
  void it("prefers the in-progress game and returns opponent, side, and marketIds", async () => {
    const res = asR(await getGame(db, { team: "Falcons" }, NOW));
    assert.equal(res["status"], "ok");
    assert.equal(asR(res["game"])["status"], "in_progress");
    assert.equal(res["teamSide"], "home");
    assert.equal(asR(res["opponent"])["name"], "New Orleans Saints");
    const markets = asArr(res["markets"]);
    assert.equal(markets.length, 2);
    assert.deepEqual(
      markets.map((m) => m["marketId"]).toSorted(),
      [M0, M1].toSorted(),
    );
    assert.equal(markets.find((m) => m["outcomeIndex"] === 0)?.["outcomeLabel"], "Atlanta Falcons to win");
  });

  void it("selects by date window when a date is given", async () => {
    const res = asR(await getGame(db, { team: "Falcons", date: "2026-08-30", windowDays: 2 }, NOW));
    assert.equal(res["status"], "ok");
    assert.equal(asR(res["game"])["eventId"], "e-f1");
  });

  void it("reports not_found with the nearest game when the window is empty", async () => {
    const res = asR(await getGame(db, { team: "Falcons", date: "2026-06-01", windowDays: 3 }, NOW));
    assert.equal(res["status"], "not_found");
    assert.ok(res["nearestGame"]);
  });

  void it("is unavailable (not yet ingested) when no events exist at all", async () => {
    const res = asR(await getGame(emptyDb, { team: "Falcons" }, NOW));
    assert.equal(res["status"], "unavailable");
    assert.match(String(res["reason"]), /not yet ingested/);
  });

  void it("rejects malformed input at the boundary", async () => {
    await assert.rejects(getGame(db, { team: "Falcons", date: "yesterday" }, NOW), /YYYY-MM-DD/);
    await assert.rejects(getGame(db, { team: "Falcons", surprise: 1 }, NOW), /invalid input/);
  });
});

// ─── S-012 get_live_game_state ──────────────────────────────────────────────

void describe("get_live_game_state (S-012)", () => {
  void it("returns the stored score and reports unstored fields absent, never invented", async () => {
    const res = asR(await getLiveGameState(db, { team: "Falcons" }));
    assert.equal(res["status"], "ok");
    assert.deepEqual(res["score"], { home: 14, away: 10 });
    assert.equal(res["period"], null);
    assert.equal(res["clock"], null);
    assert.equal(res["possession"], null);
    const missing = asR(res["fieldsNotStored"]);
    for (const field of ["period", "clock", "possession"]) {
      assert.match(String(missing[field]), /not yet ingested — no plays ingested/);
    }
  });

  void it("serves period/clock/possession from the latest ingested play (task 041)", async () => {
    const withPlays = makeFakeDb({
      ...fixtures(),
      plays: [
        {
          eventId: "e-live",
          sequence: 1_698_611_000_000,
          period: 1,
          clock: "10:12",
          playType: "rush",
          description: "K.Prime rushes for 4 yards",
          teamKey: "nfl:ATL",
          scoringPlay: false,
          homeScore: 7,
          awayScore: 3,
          detail: {},
        },
        {
          eventId: "e-live",
          sequence: 1_698_611_137_531, // latest play wins
          period: 2,
          clock: "12:34",
          playType: "pass",
          description: "K.Prime passes deep to D.Catchman",
          teamKey: "nfl:ATL",
          scoringPlay: true,
          homeScore: 14,
          awayScore: 10,
          detail: { possessionAfter: "nfl:NO" },
        },
      ],
    });
    const res = asR(await getLiveGameState(withPlays, { team: "Falcons" }));
    assert.equal(res["status"], "ok");
    assert.equal(res["period"], 2);
    assert.equal(res["clock"], "12:34");
    // Possession is the ball AFTER the latest play (end_situation).
    assert.equal(res["possession"], "nfl:NO");
    assert.match(String(res["liveStateSource"]), /latest ingested play/);
    assert.equal(res["fieldsNotStored"], undefined);
  });

  void it("is not_found (with the latest game) when the team has no live game", async () => {
    const res = asR(await getLiveGameState(db, { team: "Giants" }));
    assert.equal(res["status"], "not_found");
    assert.ok(res["latestGame"]);
  });

  void it("is not_found for a known but non-live providerEventId", async () => {
    const res = asR(await getLiveGameState(db, { providerEventId: "pe-e-f1" }));
    assert.equal(res["status"], "not_found");
    assert.match(String(res["note"]), /status: final/);
  });

  void it("requires team or providerEventId", async () => {
    await assert.rejects(getLiveGameState(db, {}), /provide `team` or `providerEventId`/);
  });
});

// ─── S-013 / S-014 team + player stats ──────────────────────────────────────

/** A Falcons team_records snapshot for the preferred-source tests. */
function falconsRecord(overrides: Partial<TeamRecordRow> = {}): TeamRecordRow {
  return {
    teamId: "t-atl",
    season: "2026",
    seasonType: "regular",
    wins: 11,
    losses: 6,
    ties: 0,
    divisionRank: 1,
    conferenceRank: 3,
    pointsFor: 410,
    pointsAgainst: 333,
    streak: "W3",
    homeRecord: "6-2",
    awayRecord: "5-4",
    stats: { win_pct: 0.647, home_wins: 6, home_losses: 2, road_wins: 5, road_losses: 4 },
    updatedAt: hours(-4),
    ...overrides,
  };
}

void describe("get_team_stats / get_player_stats (S-013/S-014)", () => {
  void it("prefers the ingested standings snapshot: official record + detailed stats (task 041)", async () => {
    const withRecords = makeFakeDb({ ...fixtures(), teamRecords: [falconsRecord()] });
    const res = asR(await getTeamStats(withRecords, { team: "Falcons" }));
    assert.equal(res["status"], "ok");
    assert.match(String(res["recordSource"]), /team_records/);
    const record = asR(res["record"]);
    assert.equal(record["wins"], 11);
    assert.equal(record["losses"], 6);
    assert.equal(record["divisionRank"], 1);
    assert.equal(record["streak"], "W3");
    assert.equal(record["homeRecord"], "6-2");
    assert.equal(record["awayRecord"], "5-4");
    const detailed = asR(res["detailedStats"]);
    assert.equal(detailed["status"], "ok");
    assert.deepEqual(asR(detailed["stats"])["win_pct"], 0.647);
    // The derived record is gone — the official snapshot is the answer.
    assert.equal(res["derivedRecord"], undefined);
  });

  void it("picks the latest season's regular snapshot when several exist", async () => {
    const withRecords = makeFakeDb({
      ...fixtures(),
      teamRecords: [
        falconsRecord({ season: "2025", wins: 8 }),
        falconsRecord({ season: "2026", seasonType: "preseason", wins: 2 }),
        falconsRecord({ season: "2026", seasonType: "regular", wins: 11 }),
      ],
    });
    const res = asR(await getTeamStats(withRecords, { team: "Falcons" }));
    const record = asR(res["record"]);
    assert.equal(record["season"], "2026");
    assert.equal(record["seasonType"], "regular");
    assert.equal(record["wins"], 11);
  });

  void it("marks detailedStats unavailable when the snapshot carries no aggregates", async () => {
    const withRecords = makeFakeDb({ ...fixtures(), teamRecords: [falconsRecord({ stats: {} })] });
    const res = asR(await getTeamStats(withRecords, { team: "Falcons" }));
    assert.equal(asR(res["record"])["wins"], 11);
    const detailed = asR(res["detailedStats"]);
    assert.equal(detailed["status"], "unavailable");
    assert.match(String(detailed["reason"]), /no stat aggregates/);
  });

  void it("derives the record from finished games and marks detailed stats unavailable", async () => {
    const res = asR(await getTeamStats(db, { team: "Falcons" }));
    assert.equal(res["status"], "ok");
    assert.deepEqual(res["derivedRecord"], {
      wins: 3,
      losses: 1,
      ties: 0,
      pointsFor: 96,
      pointsAgainst: 67,
      gamesCounted: 4,
    });
    const detailed = asR(res["detailedStats"]);
    assert.equal(detailed["status"], "unavailable");
    assert.match(String(detailed["reason"]), /not yet ingested/);
  });

  void it("returns the player identity with stats structurally unavailable", async () => {
    const res = asR(await getPlayerStats(db, { player: "Kirk Prime" }));
    assert.equal(res["status"], "ok");
    const p = asR(res["player"]);
    assert.equal(p["position"], "QB");
    assert.equal(p["team"], "Atlanta Falcons");
    assert.equal(asR(res["stats"])["status"], "unavailable");
  });

  void it("serves players.season_stats when present, filtered by season (task 041)", async () => {
    const withStats = makeFakeDb({
      ...fixtures(),
      seasonStats: {
        "p-qb": {
          "2025": { passing_yards: 3900, passing_touchdowns: 27 },
          "2026": { passing_yards: 1200, passing_touchdowns: 9 },
        },
      },
    });
    const all = asR(await getPlayerStats(withStats, { player: "Kirk Prime" }));
    const stats = asR(all["stats"]);
    assert.equal(stats["status"], "ok");
    assert.deepEqual(Object.keys(asR(stats["seasons"])).toSorted(), ["2025", "2026"]);

    const one = asR(await getPlayerStats(withStats, { player: "Kirk Prime", season: "2026" }));
    const oneStats = asR(one["stats"]);
    assert.equal(oneStats["status"], "ok");
    assert.deepEqual(asR(oneStats["seasons"]), {
      "2026": { passing_yards: 1200, passing_touchdowns: 9 },
    });

    // A season with no entry is an honest unavailable, never zeros.
    const missing = asR(await getPlayerStats(withStats, { player: "Kirk Prime", season: "2019" }));
    assert.equal(asR(missing["stats"])["status"], "unavailable");
    assert.match(String(asR(missing["stats"])["reason"]), /2019/);
  });

  void it("is unavailable when the players table has not been ingested", async () => {
    const res = asR(await getPlayerStats(emptyDb, { player: "Kirk Prime" }));
    assert.equal(res["status"], "unavailable");
  });
});

// ─── S-015 injuries ─────────────────────────────────────────────────────────

void describe("get_player_injury_status (S-015)", () => {
  void it("lists only OPEN reports for a team", async () => {
    const res = asR(await getPlayerInjuryStatus(db, { team: "Falcons" }));
    assert.equal(res["status"], "ok");
    const rows = asArr(res["openInjuries"]);
    assert.equal(rows.length, 1);
    assert.equal(rows.at(0)?.["player"], "Dee Catchman");
    assert.equal(rows.at(0)?.["status"], "questionable");
  });

  void it("distinguishes 'not listed' from 'feed not ingested'", async () => {
    const listedClean = asR(await getPlayerInjuryStatus(db, { player: "Kirk Prime" }));
    assert.equal(listedClean["status"], "ok");
    assert.deepEqual(listedClean["openInjuries"], []);
    assert.match(String(listedClean["note"]), /not currently listed/);

    const noFeed = makeFakeDb({ ...fixtures(), injuries: [] });
    const pending = asR(await getPlayerInjuryStatus(noFeed, { player: "Kirk Prime" }));
    assert.equal(pending["status"], "ok");
    assert.match(String(pending["note"]), /not yet ingested/);
    assert.match(String(pending["note"]), /NOT evidence/);
  });

  void it("requires player or team", async () => {
    await assert.rejects(getPlayerInjuryStatus(db, {}), /provide `player` or `team`/);
  });
});

// ─── S-016 / S-017 recent form + head-to-head ───────────────────────────────

void describe("get_recent_games / get_head_to_head (S-016/S-017)", () => {
  void it("lists finished games newest-first with W/L results from the team's perspective", async () => {
    const res = asR(await getRecentGames(db, { team: "Falcons", limit: 3 }));
    assert.equal(res["status"], "ok");
    const games = asArr(res["games"]);
    assert.equal(games.length, 3);
    assert.deepEqual(
      games.map((g) => g["result"]),
      ["W", "L", "W"],
    );
    assert.equal(games.at(0)?.["opponent"], "New York Giants");
  });

  void it("summarizes finished meetings between two teams", async () => {
    const res = asR(await getHeadToHead(db, { teamA: "Falcons", teamB: "Saints" }));
    assert.equal(res["status"], "ok");
    const summary = asR(res["summary"]);
    assert.equal(summary["Atlanta Falcons"], 1);
    assert.equal(summary["New Orleans Saints"], 1);
    assert.equal(summary["ties"], 0);
    assert.equal(asArr(res["games"]).length, 2);
  });

  void it("rejects a head-to-head of a team against itself", async () => {
    await assert.rejects(getHeadToHead(db, { teamA: "Falcons", teamB: "Atlanta" }), /same team/);
  });
});

// ─── S-018 standings ────────────────────────────────────────────────────────

void describe("get_standings (S-018)", () => {
  void it("prefers the ingested official snapshot with ranks and staleness (task 041)", async () => {
    const withRecords = makeFakeDb({
      ...fixtures(),
      teamRecords: [
        falconsRecord(),
        falconsRecord({ teamId: "t-no", wins: 9, losses: 8, divisionRank: 2, streak: "L1" }),
      ],
    });
    const res = asR(await getStandings(withRecords, {}));
    assert.equal(res["status"], "ok");
    assert.match(String(res["note"]), /team_records/);
    const league = asR(asArr(res["leagues"]).at(0));
    assert.equal(league["source"], "team_records");
    assert.equal(league["season"], "2026");
    assert.equal(league["seasonType"], "regular");
    assert.ok(league["asOf"]);
    const rows = asArr(league["standings"]);
    assert.equal(rows.at(0)?.["team"], "Atlanta Falcons"); // divisionRank 1
    assert.equal(rows.at(0)?.["divisionRank"], 1);
    assert.equal(rows.at(0)?.["streak"], "W3");
    assert.equal(rows.at(1)?.["team"], "New Orleans Saints");
  });

  void it("derives a sorted table from finished games and says it is derived", async () => {
    const res = asR(await getStandings(db, {}));
    assert.equal(res["status"], "ok");
    assert.match(String(res["note"]), /aggregated from finished games/);
    const league = asR(asArr(res["leagues"]).at(0));
    assert.equal(league["league"], "nfl");
    assert.equal(league["source"], "derived");
    const rows = asArr(league["standings"]);
    assert.equal(rows.at(0)?.["team"], "Atlanta Falcons");
    assert.equal(rows.at(0)?.["wins"], 3);
    assert.equal(rows.at(0)?.["winPct"], 0.75);
    assert.equal(rows.at(1)?.["team"], "New Orleans Saints");
  });

  void it("is unavailable when no finished games exist to derive from", async () => {
    const noFinals = makeFakeDb({
      ...fixtures(),
      events: fixtures().events.filter((e) => e.status !== "final"),
    });
    const res = asR(await getStandings(noFinals, {}));
    assert.equal(res["status"], "unavailable");
    assert.match(String(res["reason"]), /not yet ingested/);
  });
});

// ─── S-019 play-by-play ─────────────────────────────────────────────────────

void describe("get_play_by_play (S-019)", () => {
  void it("is a structured unavailable (with the game echoed) while no plays are ingested", async () => {
    const res = asR(await getPlayByPlay(db, { team: "Falcons" }));
    assert.equal(res["status"], "unavailable");
    assert.match(String(res["reason"]), /not yet ingested/);
    assert.equal(res["plays"], null);
    assert.ok(res["game"]);
    // The team query resolves to the live game, where plays would be.
    assert.equal(asR(res["game"])["status"], "in_progress");
  });

  void it("serves ingested plays newest-first with running scores (task 041)", async () => {
    const withPlays = makeFakeDb({
      ...fixtures(),
      plays: [
        {
          eventId: "e-live",
          sequence: 1_698_611_000_000,
          period: 1,
          clock: "10:12",
          playType: "rush",
          description: "K.Prime rushes for 4 yards",
          teamKey: "nfl:ATL",
          scoringPlay: false,
          homeScore: 7,
          awayScore: 3,
          detail: {},
        },
        {
          eventId: "e-live",
          sequence: 1_698_611_137_531,
          period: 2,
          clock: "12:34",
          playType: "pass",
          description: "K.Prime passes deep to D.Catchman for a touchdown",
          teamKey: "nfl:ATL",
          scoringPlay: true,
          homeScore: 14,
          awayScore: 10,
          detail: { possessionAfter: "nfl:NO" },
        },
      ],
    });
    const res = asR(await getPlayByPlay(withPlays, { team: "Falcons" }));
    assert.equal(res["status"], "ok");
    assert.equal(res["count"], 2);
    const plays = asArr(res["plays"]);
    // Newest first — the epoch-ms-scale provider sequence orders them.
    assert.equal(plays.at(0)?.["sequence"], 1_698_611_137_531);
    assert.equal(plays.at(0)?.["playType"], "pass");
    assert.equal(plays.at(0)?.["scoringPlay"], true);
    assert.deepEqual(
      [plays.at(0)?.["homeScore"], plays.at(0)?.["awayScore"]],
      [14, 10],
    );
    assert.equal(plays.at(1)?.["playType"], "rush");

    // limit is honored.
    const limited = asR(await getPlayByPlay(withPlays, { team: "Falcons", limit: 1 }));
    assert.equal(limited["count"], 1);
  });

  void it("resolves by providerEventId and distinguishes unknown game from playless game", async () => {
    const res = asR(await getPlayByPlay(db, { providerEventId: "pe-e-f1" }));
    assert.equal(res["status"], "unavailable"); // known game, no plays stored
    const miss = asR(await getPlayByPlay(db, { providerEventId: "pe-nope" }));
    assert.equal(miss["status"], "not_found");
  });
});

// ─── S-020 market tools ─────────────────────────────────────────────────────

void describe("market tools (S-020)", () => {
  void it("get_market_price returns the latest capture with bps and age", async () => {
    const res = asR(await getMarketPrice(db, { marketId: M0 }, NOW));
    assert.equal(res["status"], "ok");
    assert.equal(res["impliedProbability"], 0.66);
    assert.equal(res["impliedProbabilityBps"], 6600);
    assert.equal(res["source"], "pool");
    assert.equal(res["ageSeconds"], 1800);
  });

  void it("get_market_price distinguishes unknown market from no captures yet", async () => {
    const miss = asR(await getMarketPrice(db, { marketId: `0x${"9".repeat(64)}` }, NOW));
    assert.equal(miss["status"], "not_found");
    const noCapture = asR(await getMarketPrice(db, { marketId: M1 }, NOW));
    assert.equal(noCapture["status"], "unavailable");
    assert.match(String(noCapture["reason"]), /not yet ingested/);
    assert.equal(asR(noCapture["market"])["openingProbability"], 0.38);
  });

  void it("get_market_history returns the series oldest-first with the window change", async () => {
    const res = asR(await getMarketHistory(db, { marketId: M0 }));
    assert.equal(res["status"], "ok");
    const points = asArr(res["points"]);
    assert.deepEqual(
      points.map((p) => p["impliedProbability"]),
      [0.6, 0.63, 0.66],
    );
    assert.equal(res["changeOverWindow"], 0.06);
  });

  void it("get_market_volume aggregates fills inside the window only", async () => {
    const res = asR(await getMarketVolume(db, { marketId: M0, windowHours: 24 }, NOW));
    assert.equal(res["status"], "ok");
    assert.equal(res["trades"], 3); // the 48h-old fill is excluded
    assert.equal(res["buys"], 2);
    assert.equal(res["sells"], 1);
    assert.equal(res["buyVolumeUsdc"], 150);
    assert.equal(res["sellVolumeUsdc"], 30);
    assert.equal(res["totalVolumeUsdc"], 180);
  });

  void it("get_market_volume states the ambiguity of zero fills instead of inventing meaning", async () => {
    const res = asR(await getMarketVolume(db, { marketId: M1, windowHours: 24 }, NOW));
    assert.equal(res["status"], "ok");
    assert.equal(res["trades"], 0);
    assert.match(String(res["note"]), /no trading or indexing still pending/);
  });

  void it("get_market_liquidity is a graceful null before pool deployment", async () => {
    const res = asR(await getMarketLiquidity(db, { marketId: M1 }));
    assert.equal(res["status"], "ok");
    assert.equal(res["poolDeployed"], false);
    assert.equal(res["liquidityUsdc"], null);
    assert.match(String(res["note"]), /not deployed/);
  });

  void it("get_market_liquidity reads the latest capture that recorded depth", async () => {
    const res = asR(await getMarketLiquidity(db, { marketId: M0 }));
    assert.equal(res["status"], "ok");
    assert.equal(res["poolDeployed"], true);
    assert.equal(res["liquidityUsdc"], 2500);
  });

  void it("rejects malformed market ids at the boundary", async () => {
    await assert.rejects(getMarketPrice(db, { marketId: "market-1" }), /66-char/);
    await assert.rejects(getMarketHistory(db, { marketId: M0, limit: 0 }), /invalid input/);
  });
});

// ─── S-021 composition test ─────────────────────────────────────────────────

void describe("S-021 — 'Should I buy the Falcons YES contract?' composition", () => {
  void it("composes the full analysis from the single user identifier 'Falcons'", async () => {
    // The ONLY user-supplied identifier in this whole flow:
    const USER_INPUT = "Falcons";

    // 1. Find the game — event, side, opponent, and marketIds all come back.
    const game = asR(await getGame(db, { team: USER_INPUT }, NOW));
    assert.equal(game["status"], "ok");
    assert.equal(asR(game["game"])["status"], "in_progress");

    // 2. Opponent comes from the tool result, not the user.
    const opponent = String(asR(game["opponent"])["name"]);
    assert.equal(opponent, "New Orleans Saints");

    // The Falcons YES market (outcomeIndex 0 = the team's side is home here).
    const falconsMarket = asArr(game["markets"]).find((m) => m["outcomeIndex"] === 0);
    assert.ok(falconsMarket, "get_game must hand back the Falcons market");
    const marketId = String(falconsMarket["marketId"]);

    // 3. Live state — score present, unstored fields honestly absent.
    const live = asR(await getLiveGameState(db, { team: USER_INPUT }));
    assert.equal(live["status"], "ok");
    assert.deepEqual(live["score"], { home: 14, away: 10 });
    assert.equal(live["period"], null);

    // 4. Injuries — our side and the opponent's (name from step 2).
    const ourInjuries = asR(await getPlayerInjuryStatus(db, { team: USER_INPUT }));
    assert.equal(ourInjuries["status"], "ok");
    assert.equal(asArr(ourInjuries["openInjuries"]).length, 1);
    const theirInjuries = asR(await getPlayerInjuryStatus(db, { team: opponent }));
    assert.equal(theirInjuries["status"], "ok");
    assert.deepEqual(theirInjuries["openInjuries"], []);

    // 5. Recent form.
    const recent = asR(await getRecentGames(db, { team: USER_INPUT, limit: 5 }));
    assert.equal(recent["status"], "ok");
    assert.equal(asArr(recent["games"]).length, 4);

    // 6. Head-to-head vs the tool-derived opponent.
    const h2h = asR(await getHeadToHead(db, { teamA: USER_INPUT, teamB: opponent }));
    assert.equal(h2h["status"], "ok");
    assert.equal(asArr(h2h["games"]).length, 2);

    // 7-9. Market read chain, all keyed by the marketId from step 1.
    const price = asR(await getMarketPrice(db, { marketId }, NOW));
    assert.equal(price["status"], "ok");
    assert.equal(price["impliedProbabilityBps"], 6600);

    const liquidity = asR(await getMarketLiquidity(db, { marketId }));
    assert.equal(liquidity["status"], "ok");
    assert.equal(liquidity["liquidityUsdc"], 2500);

    const history = asR(await getMarketHistory(db, { marketId }));
    assert.equal(history["status"], "ok");
    assert.equal(asArr(history["points"]).length, 3);

    const volume = asR(await getMarketVolume(db, { marketId }, NOW));
    assert.equal(volume["status"], "ok");
    assert.equal(volume["trades"], 3);

    // Every category of the composed answer is present and grounded.
    for (const [category, result] of [
      ["game", game],
      ["liveState", live],
      ["recentForm", recent],
      ["headToHead", h2h],
      ["price", price],
      ["liquidity", liquidity],
      ["history", history],
      ["volume", volume],
    ] as const) {
      assert.equal(asR(result)["status"], "ok", `category ${category} must resolve`);
    }
  });
});

// ─── 030 rule — the whole suite is read-only, no audit rows ─────────────────

void describe("039 tools are read-only under the 030 audit rule", () => {
  void it("auditActionForToolCall maps every sports-data tool to null (no audit row)", async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
    process.env.PRIVY_APP_ID ??= "test-stub";
    process.env.PRIVY_APP_SECRET ??= "test-stub";
    const { auditActionForToolCall } = await import("../agent-chat.ts");
    for (const tool of [
      "get_game",
      "get_live_game_state",
      "get_team_stats",
      "get_player_stats",
      "get_player_injury_status",
      "get_recent_games",
      "get_head_to_head",
      "get_standings",
      "get_play_by_play",
      "get_market_price",
      "get_market_history",
      "get_market_volume",
      "get_market_liquidity",
    ]) {
      assert.equal(auditActionForToolCall(tool, {}), null, tool);
    }
  });
});
