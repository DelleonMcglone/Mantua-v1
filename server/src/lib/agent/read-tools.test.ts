import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { searchMarkets, summarizeMarketPositions } from "./read-tools.ts";
import type { PublicSlate } from "../sports/public-slate.ts";
import type { MarketPositionRow } from "../sports/market-positions.ts";

/** Phase 8 / A-020, A-023, A-024 — the pure halves of the composed read tools. */

const NOW = Date.UTC(2026, 8, 12, 20, 0, 0);
const sec = (h: number): number => Math.floor((NOW + h * 3_600_000) / 1000);

const team = (key: string, name: string) => ({ key, name, abbreviation: key });

const NFL: PublicSlate = {
  league: "nfl",
  provider: "canonical",
  delayed: false,
  fetchedAt: NOW,
  events: [
    {
      providerEventId: "401",
      startsAt: sec(-1),
      status: "in_progress",
      home: team("ATL", "Atlanta Falcons"),
      away: team("NO", "New Orleans Saints"),
      homeScore: 14,
      awayScore: 10,
      homeWinProbabilityBps: 6600,
      liveOdds: true,
    },
    {
      providerEventId: "402",
      startsAt: sec(30),
      status: "scheduled",
      home: team("NYG", "New York Giants"),
      away: team("NYJ", "New York Jets"),
      homeWinProbabilityBps: 4800,
    },
    {
      providerEventId: "403",
      startsAt: sec(-100),
      status: "final",
      home: team("ATL", "Atlanta Falcons"),
      away: team("NYG", "New York Giants"),
      homeScore: 24,
      awayScore: 17,
    },
  ],
};

const WNBA: PublicSlate = {
  league: "wnba",
  provider: "canonical",
  delayed: true,
  fetchedAt: NOW,
  dataAsOf: NOW - 3_600_000,
  events: [
    {
      providerEventId: "501",
      startsAt: sec(5),
      status: "scheduled",
      home: team("LV", "Las Vegas Aces"),
      away: team("NY", "New York Liberty"),
      homeWinProbabilityBps: 5500,
    },
  ],
};

void describe("searchMarkets", () => {
  void it("ranks live, then upcoming soonest, then final most recent; all leagues by default", () => {
    const { rows, total } = searchMarkets([NFL, WNBA], {}, NOW);
    assert.equal(total, 4);
    assert.deepEqual(
      rows.map((r) => [r.providerEventId, r.status]),
      [
        ["401", "live"],
        ["501", "upcoming"],
        ["402", "upcoming"],
        ["403", "final"],
      ],
    );
    const live = rows[0];
    assert.equal(live.matchup, "New Orleans Saints @ Atlanta Falcons");
    assert.equal(live.awayWinProbabilityBps, 3400);
    assert.equal(live.liveOdds, true);
    assert.deepEqual(live.outcomes[1], {
      outcomeIndex: 1,
      label: "New Orleans Saints to win (YES)",
    });
  });

  void it("filters by team fragment, key, league and status", () => {
    assert.deepEqual(
      searchMarkets([NFL, WNBA], { query: "falcons" }, NOW).rows.map((r) => r.providerEventId),
      ["401", "403"],
    );
    assert.deepEqual(
      searchMarkets([NFL, WNBA], { query: "nyj" }, NOW).rows.map((r) => r.providerEventId),
      ["402"],
    );
    assert.deepEqual(
      searchMarkets([NFL, WNBA], { query: "New York", status: "upcoming" }, NOW).rows.map(
        (r) => r.providerEventId,
      ),
      ["501", "402"],
    );
    assert.deepEqual(
      searchMarkets([NFL, WNBA], { league: "wnba" }, NOW).rows.map((r) => r.providerEventId),
      ["501"],
    );
    const none = searchMarkets([NFL, WNBA], { query: "Cowboys" }, NOW);
    assert.equal(none.rows.length, 0);
    assert.match(none.note ?? "", /No game matches "Cowboys"/);
  });

  void it("flags delayed rows and caps the limit", () => {
    const res = searchMarkets([NFL, WNBA], { limit: 2 }, NOW);
    assert.equal(res.rows.length, 2);
    assert.equal(res.total, 4);
    assert.equal(res.rows[1]?.delayed, true);
    assert.equal(res.rows[1]?.dataAsOf, new Date(NOW - 3_600_000).toISOString());
    assert.match(res.note ?? "", /delayed/);
  });
});

void describe("summarizeMarketPositions", () => {
  const rows: MarketPositionRow[] = [
    {
      marketId: "0xaaa",
      outcomeIndex: 0,
      label: "Atlanta Falcons to beat New Orleans Saints",
      state: "OPEN",
      startsAt: sec(-1),
      side: "yes",
      balance: "16000000",
      impliedProbBps: 6600,
      valueRaw: "10560000",
      league: "nfl",
      providerEventId: "401",
      entryPriceBps: 6250,
      pnlRaw: "560000",
    },
    {
      marketId: "0xbbb",
      outcomeIndex: 1,
      label: "New York Jets to beat New York Giants",
      state: "OPEN",
      startsAt: sec(30),
      side: "no",
      balance: "5000000",
      impliedProbBps: null,
      valueRaw: "0",
      league: "nfl",
      providerEventId: "402",
      entryPriceBps: null,
      pnlRaw: null,
    },
  ];

  void it("shapes positions with USD values, totals, and an exit hint for open YES positions", () => {
    const s = summarizeMarketPositions(rows);
    assert.equal(s.totals.count, 2);
    assert.equal(s.totals.valueUsd, 10.56);
    assert.equal(s.totals.pnlUsd, 0.56);
    assert.equal(s.totals.unpriced, 1);
    const yes = s.positions[0];
    assert.equal(yes.tokens, 16);
    assert.equal(yes.valueUsd, 10.56);
    assert.deepEqual(yes.exit, {
      direction: "sell",
      providerEventId: "401",
      outcomeIndex: 0,
      amount: "16",
    });
    assert.equal(s.positions[1]?.valueUsd, null);
    assert.equal(s.positions[1]?.exit, null, "NO-side positions have no agent sell path");
  });

  void it("filters by providerEventId or marketId (case-insensitive)", () => {
    assert.equal(
      summarizeMarketPositions(rows, { providerEventId: "402" }).positions[0]?.marketId,
      "0xbbb",
    );
    assert.equal(summarizeMarketPositions(rows, { marketId: "0xAAA" }).totals.count, 1);
    assert.equal(summarizeMarketPositions(rows, { providerEventId: "999" }).totals.count, 0);
  });
});
