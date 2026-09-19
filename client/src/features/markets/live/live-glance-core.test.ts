import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { glanceRows, positionSide, sideCents, usd } from "./live-glance-core.ts";
import type { MarketPositionRow } from "../../portfolio/portfolio-core.ts";
import type { SlateEvent } from "../use-slate.ts";

const KC = { key: "nfl:KC", name: "Kansas City Chiefs", abbreviation: "KC" };
const LV = { key: "nfl:LV", name: "Las Vegas Raiders", abbreviation: "LV" };
const live: SlateEvent = {
  providerEventId: "4015",
  startsAt: 1_800_000_000,
  status: "in_progress",
  home: LV,
  away: KC,
  homeScore: 10,
  awayScore: 14,
  homeWinProbabilityBps: 3800,
  liveOdds: true,
};
const later: SlateEvent = {
  ...live,
  providerEventId: "4016",
  startsAt: 1_800_003_600,
  homeScore: 0,
  awayScore: 3,
};
const scheduled: SlateEvent = { ...live, providerEventId: "4017", status: "scheduled" };
const position: MarketPositionRow = {
  marketId: "0xm",
  outcomeIndex: 0,
  label: "Las Vegas Raiders to beat Kansas City Chiefs",
  state: "OPEN",
  side: "no",
  balance: "200000000",
  impliedProbBps: 6200,
  valueRaw: "124000000",
  league: "nfl",
  providerEventId: "4016",
  entryPriceBps: 5000,
  pnlRaw: "24000000",
};

void describe("live glance (MX-003)", () => {
  void it("lists only games in progress, the held game first, with score, prices and the position", () => {
    const rows = glanceRows([live, later, scheduled], [position]);
    assert.deepEqual(
      rows.map((r) => r.eventId),
      ["4016", "4015"],
    );
    const held = rows[0];
    assert.equal(held.score, "KC 3 · LV 0");
    assert.deepEqual(held.priceCents, { home: 38, away: 62 });
    assert.equal(held.positions.length, 1);
    const p = held.positions[0];
    // NO on the home market = long the away team.
    assert.equal(p.side, 1);
    assert.equal(p.team, "Kansas City Chiefs");
    assert.equal(p.contracts, 200);
    assert.equal(p.valueUsd, 124);
    assert.equal(p.pnlUsd, 24);
    assert.equal(p.priceCents, 62);
    assert.equal(p.close, null, "a NO position has no one-tap close (B7-003 sells YES)");
    assert.deepEqual(rows[1].positions, []);
  });

  void it("attaches the one-tap exit to a YES position and tolerates missing data", () => {
    const yes = { ...position, side: "yes" as const, providerEventId: "4015" };
    const [row] = glanceRows([live], [yes]);
    assert.equal(row.positions[0].side, 0);
    assert.equal(row.positions[0].team, "Las Vegas Raiders");
    assert.deepEqual(row.positions[0].close, {
      league: "nfl",
      eventId: "4015",
      balance: "200000000",
    });
    const { homeScore: _hs, homeWinProbabilityBps: _p, ...noScore } = live;
    void _hs;
    void _p;
    const [bare] = glanceRows([noScore], null);
    assert.equal(bare.score, null);
    assert.deepEqual(bare.priceCents, { home: null, away: null });
    assert.deepEqual(glanceRows([live], [{ ...yes, balance: "0" }])[0].positions, []);
  });

  void it("prices a side and formats dollars", () => {
    assert.equal(sideCents(3800, 0), 38);
    assert.equal(sideCents(3800, 1), 62);
    assert.equal(sideCents(undefined, 0), null);
    assert.equal(positionSide({ side: "yes", outcomeIndex: 1 }), 1);
    assert.equal(positionSide({ side: "no", outcomeIndex: 1 }), 0);
    assert.equal(usd(1234.5), "$1,234.50");
    assert.equal(usd(-3), "−$3.00");
  });
});
