import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  americanToProbability,
  impliedHomeWinProbabilityBps,
  spreadToHomeProbability,
} from "./espn-odds.ts";
import { parseInjuries, parseStandings } from "./espn-reference.ts";

void describe("implied win probability", () => {
  void it("reads American odds both ways", () => {
    assert.ok(Math.abs((americanToProbability("-485") ?? 0) - 0.829) < 0.001);
    assert.ok(Math.abs((americanToProbability("+370") ?? 0) - 0.2128) < 0.001);
    assert.equal(americanToProbability("EVEN"), null);
  });

  void it("removes the vig from a two-sided moneyline", () => {
    const bps = impliedHomeWinProbabilityBps({
      odds: [
        {
          spread: -9.5,
          moneyline: { home: { close: { odds: "-485" } }, away: { close: { odds: "+370" } } },
        },
      ],
    });
    // 0.829 / (0.829 + 0.2128) ≈ 0.7958
    assert.ok(bps !== undefined && Math.abs(bps - 7958) <= 5, String(bps));
  });

  void it("falls back to the spread, and a pick'em is a coin flip", () => {
    assert.ok(Math.abs(spreadToHomeProbability(0) - 0.5) < 1e-6);
    const fav = impliedHomeWinProbabilityBps({ odds: [{ spread: -3 }] });
    assert.ok(fav !== undefined && fav > 5700 && fav < 6000, String(fav));
    const dog = impliedHomeWinProbabilityBps({ odds: [{ spread: 6.5 }] });
    assert.ok(dog !== undefined && dog > 2900 && dog < 3400, String(dog));
  });

  void it("yields nothing without a usable line", () => {
    assert.equal(impliedHomeWinProbabilityBps({}), undefined);
    assert.equal(impliedHomeWinProbabilityBps({ odds: [{ details: "OFF" }] }), undefined);
  });
});

void describe("parseInjuries", () => {
  const payload = {
    injuries: [
      {
        displayName: "Arizona Cardinals",
        injuries: [
          {
            date: "2026-10-05T23:51Z",
            type: { name: "INJURY_STATUS_QUESTIONABLE" },
            details: { type: "Knee", detail: "Bruise" },
            athlete: {
              displayName: "Andrew Wingard",
              position: { abbreviation: "S" },
              team: { abbreviation: "ARI" },
              links: [{ href: "https://www.espn.com/nfl/player/_/id/3125116/andrew-wingard" }],
            },
          },
          {
            type: { name: "INJURY_STATUS_SUSPENSION" },
            athlete: { displayName: "X", team: { abbreviation: "ARI" } },
          },
          {
            type: { name: "INJURY_STATUS_OUT" },
            athlete: { displayName: "No Id", team: { abbreviation: "ARI" } },
          },
        ],
      },
    ],
  };

  void it("maps status, body part, team key and the athlete id from the link", () => {
    const rows = parseInjuries(payload, "nfl");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      providerPlayerId: "3125116",
      playerName: "Andrew Wingard",
      teamKey: "nfl:ARI",
      status: "questionable",
      description: "Knee — Bruise",
      providerUpdatedAt: Math.floor(Date.parse("2026-10-05T23:51Z") / 1000),
      position: "S",
    });
    assert.equal(rows[1]?.providerPlayerId, "name:ARI:no-id");
    assert.equal(rows[1]?.status, "out");
  });

  void it("returns nothing for a payload it does not recognise", () => {
    assert.deepEqual(parseInjuries({ nope: true }, "nfl"), []);
  });
});

void describe("parseStandings", () => {
  void it("reads wins, points, streak and splits per team", () => {
    const rows = parseStandings(
      {
        children: [
          {
            standings: {
              season: 2026,
              seasonType: 2,
              entries: [
                {
                  team: { id: "12", abbreviation: "KC" },
                  stats: [
                    { name: "wins", value: 4 },
                    { name: "losses", value: 0 },
                    { name: "ties", value: 0 },
                    { name: "pointsFor", value: 118 },
                    { name: "pointsAgainst", value: 77 },
                    { name: "streak", value: 4, displayValue: "W4" },
                    { name: "playoffSeed", value: 1 },
                    { name: "winPercent", value: 1 },
                    { name: "Home", displayValue: "2-0" },
                    { name: "Road", displayValue: "2-0" },
                  ],
                },
                { team: { id: "1" }, stats: [] },
              ],
            },
          },
        ],
      },
      "nfl",
    );
    assert.deepEqual(rows, [
      {
        providerTeamId: "12",
        teamKey: "nfl:KC",
        season: "2026",
        seasonType: "regular",
        wins: 4,
        losses: 0,
        ties: 0,
        conferenceRank: 1,
        pointsFor: 118,
        pointsAgainst: 77,
        streak: "W4",
        homeRecord: "2-0",
        awayRecord: "2-0",
        stats: { winPercent: 1 },
      },
    ]);
  });
});
