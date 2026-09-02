import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EspnProvider,
  mapStatus,
  parseEvent,
  parseHomeWinProbabilityBps,
  parseSlate,
} from "./espn.ts";
import { ProviderShapeError, isSettleable, isVoidStatus, teamKey } from "./provider.ts";

/**
 * B3-002 / B3-004 tests. Fixtures only — no test touches the network, because a
 * suite that depends on an undocumented third-party endpoint fails for reasons
 * that have nothing to do with the code.
 */

function competitor(homeAway: "home" | "away", id: string, abbr: string, score?: string) {
  return {
    homeAway,
    ...(score !== undefined ? { score } : {}),
    team: { id, abbreviation: abbr, displayName: `${abbr} Team`, logo: `https://cdn/${abbr}.png` },
  };
}

function espnEvent(
  opts: {
    id?: string;
    date?: string;
    statusName?: string;
    statusState?: string;
    homeScore?: string;
    awayScore?: string;
    odds?: unknown[];
  } = {},
) {
  return {
    id: opts.id ?? "401671789",
    date: opts.date ?? "2026-09-14T17:00Z",
    competitions: [
      {
        competitors: [
          competitor("away", "12", "LV", opts.awayScore),
          competitor("home", "12345", "KC", opts.homeScore),
        ],
        status: {
          type: { name: opts.statusName ?? "STATUS_SCHEDULED", state: opts.statusState ?? "pre" },
        },
        ...(opts.odds ? { odds: opts.odds } : {}),
      },
    ],
  };
}

void describe("mapStatus", () => {
  void it("maps the statuses ESPN actually emits", () => {
    assert.equal(mapStatus("STATUS_SCHEDULED", "pre"), "scheduled");
    assert.equal(mapStatus("STATUS_IN_PROGRESS", "in"), "in_progress");
    assert.equal(mapStatus("STATUS_HALFTIME", "in"), "in_progress");
    assert.equal(mapStatus("STATUS_FINAL", "post"), "final");
    assert.equal(mapStatus("STATUS_FINAL_OVERTIME", "post"), "final");
    assert.equal(mapStatus("STATUS_POSTPONED", "post"), "postponed");
    assert.equal(mapStatus("STATUS_CANCELED", "post"), "cancelled");
  });

  void it("treats a suspended game as postponed, not final", () => {
    assert.equal(mapStatus("STATUS_SUSPENDED", "in"), "postponed");
  });

  void it("treats a delayed game as still scheduled", () => {
    assert.equal(mapStatus("STATUS_DELAYED", "pre"), "scheduled");
  });

  void it("returns unknown for an unrecognised name rather than guessing", () => {
    // The important case. `state: "post"` would tempt a mapping to "final",
    // which would let an unrecognised status settle a market (spec §3.5).
    assert.equal(mapStatus("STATUS_SOMETHING_NEW", "post"), "unknown");
    assert.equal(isSettleable(mapStatus("STATUS_SOMETHING_NEW", "post")), false);
  });

  void it("falls back to state only when there is no name at all", () => {
    assert.equal(mapStatus(undefined, "post"), "final");
    assert.equal(mapStatus(null, "in"), "in_progress");
  });

  void it("returns unknown when both fields are missing", () => {
    assert.equal(mapStatus(undefined, undefined), "unknown");
  });
});

void describe("parseEvent", () => {
  void it("normalises a scheduled game", () => {
    const e = parseEvent(espnEvent(), "nfl");
    assert.equal(e.providerEventId, "401671789");
    assert.equal(e.league, "nfl");
    assert.equal(e.status, "scheduled");
    assert.equal(e.startsAt, Math.floor(Date.parse("2026-09-14T17:00Z") / 1000));
    assert.equal(e.home.abbreviation, "KC");
    assert.equal(e.away.abbreviation, "LV");
  });

  void it("assigns home and away from the flag, not array order", () => {
    // The fixture deliberately lists away first. Trusting order would invert
    // every market's outcome index.
    const e = parseEvent(espnEvent(), "nfl");
    assert.equal(e.home.abbreviation, "KC");
    assert.equal(e.away.abbreviation, "LV");
  });

  void it("builds provider-agnostic team keys (B3-004)", () => {
    const e = parseEvent(espnEvent(), "nfl");
    assert.equal(e.home.key, teamKey("nfl", "KC"));
    assert.equal(e.home.key, "nfl:KC");
  });

  void it("namespaces team keys by league so abbreviations cannot collide", () => {
    assert.notEqual(teamKey("nfl", "LV"), teamKey("wnba", "LV"));
  });

  void it("carries scores when present and omits them when not", () => {
    const live = parseEvent(
      espnEvent({ statusName: "STATUS_IN_PROGRESS", homeScore: "21", awayScore: "17" }),
      "nfl",
    );
    assert.equal(live.homeScore, 21);
    assert.equal(live.awayScore, 17);

    const scheduled = parseEvent(espnEvent(), "nfl");
    assert.equal(scheduled.homeScore, undefined);
  });

  void it("rejects an event with no id", () => {
    const bad = { ...espnEvent(), id: "" };
    assert.throws(() => parseEvent(bad, "nfl"), ProviderShapeError);
  });

  void it("rejects an unparseable date", () => {
    assert.throws(() => parseEvent(espnEvent({ date: "not a date" }), "nfl"), ProviderShapeError);
  });

  void it("rejects an event missing one side", () => {
    const bad = {
      id: "1",
      date: "2026-09-14T17:00Z",
      competitions: [{ competitors: [competitor("home", "1", "KC")], status: {} }],
    };
    assert.throws(() => parseEvent(bad, "nfl"), ProviderShapeError);
  });

  void it("rejects a team with no abbreviation", () => {
    const bad = {
      id: "1",
      date: "2026-09-14T17:00Z",
      competitions: [
        {
          competitors: [
            { homeAway: "home", team: { id: "1", abbreviation: "" } },
            competitor("away", "2", "LV"),
          ],
          status: {},
        },
      ],
    };
    assert.throws(() => parseEvent(bad, "nfl"), ProviderShapeError);
  });
});

void describe("parseHomeWinProbabilityBps", () => {
  void it("reads a percentage into bps", () => {
    const comp = { odds: [{ homeTeamOdds: { winPercentage: 62.5 } }] };
    assert.equal(parseHomeWinProbabilityBps(comp), 6250);
  });

  void it("drops a value at or outside the open interval rather than clamping", () => {
    // A bad opening probability seeds the pool at the wrong price (B1-009), so
    // 50/50 is a more honest default than a rescued number.
    assert.equal(
      parseHomeWinProbabilityBps({ odds: [{ homeTeamOdds: { winPercentage: 0 } }] }),
      undefined,
    );
    assert.equal(
      parseHomeWinProbabilityBps({ odds: [{ homeTeamOdds: { winPercentage: 100 } }] }),
      undefined,
    );
    assert.equal(
      parseHomeWinProbabilityBps({ odds: [{ homeTeamOdds: { winPercentage: 140 } }] }),
      undefined,
    );
  });

  void it("returns undefined when odds are absent or empty", () => {
    assert.equal(parseHomeWinProbabilityBps({}), undefined);
    assert.equal(parseHomeWinProbabilityBps({ odds: [] }), undefined);
  });
});

void describe("parseSlate", () => {
  void it("parses every valid event", () => {
    const payload = { events: [espnEvent({ id: "1" }), espnEvent({ id: "2" })] };
    assert.equal(parseSlate(payload, "nfl").length, 2);
  });

  void it("skips a malformed event instead of losing the slate", () => {
    // ESPN emits placeholder entries for unannounced matchups; dropping the
    // whole slate over one would stop every other market being created.
    const payload = { events: [espnEvent({ id: "1" }), { id: "junk" }, espnEvent({ id: "3" })] };
    const events = parseSlate(payload, "nfl");
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((e) => e.providerEventId),
      ["1", "3"],
    );
  });

  void it("throws when the payload has no events array at all", () => {
    assert.throws(() => parseSlate({ nope: true }, "nfl"), ProviderShapeError);
  });
});

void describe("EspnProvider", () => {
  void it("serves both DM-105 leagues", () => {
    const p = new EspnProvider();
    assert.deepEqual([...p.leagues], ["nfl", "wnba"]);
  });

  void it("requests the right league path", async () => {
    const urls: string[] = [];
    const fake: typeof fetch = (input) => {
      urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(
        new Response(JSON.stringify({ events: [espnEvent()] }), { status: 200 }),
      );
    };

    const p = new EspnProvider(fake);
    await p.getSlate("nfl");
    await p.getSlate("wnba");

    assert.ok(urls[0]?.includes("football/nfl/scoreboard"), urls[0]);
    assert.ok(urls[1]?.includes("basketball/wnba/scoreboard"), urls[1]);
  });

  void it("reports a live slate as not delayed", async () => {
    const fake: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ events: [espnEvent()] }), { status: 200 }));
    const slate = await new EspnProvider(fake).getSlate("nfl");
    assert.equal(slate.delayed, false);
    assert.equal(slate.provider, "espn");
    assert.equal(slate.events.length, 1);
  });
});

void describe("void statuses drive the spec §3.7 path", () => {
  void it("postponed and cancelled are void; final and scheduled are not", () => {
    assert.equal(isVoidStatus("postponed"), true);
    assert.equal(isVoidStatus("cancelled"), true);
    assert.equal(isVoidStatus("final"), false);
    assert.equal(isVoidStatus("scheduled"), false);
    assert.equal(isVoidStatus("unknown"), false);
  });
});
