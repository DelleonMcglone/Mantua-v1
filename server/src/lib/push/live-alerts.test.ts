import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gameEventFor, gameTransitions, positionAlerts, type HeldPosition } from "./live-alerts.ts";
import type { ProviderEvent } from "../sports/provider.ts";

const KC = { key: "nfl:KC", providerId: "12", name: "Kansas City Chiefs", abbreviation: "KC" };
const LV = { key: "nfl:LV", providerId: "13", name: "Las Vegas Raiders", abbreviation: "LV" };
const game = (status: ProviderEvent["status"], scores?: [number, number]): ProviderEvent => ({
  providerEventId: "4015",
  league: "nfl",
  startsAt: 1_800_000_000,
  status,
  home: LV,
  away: KC,
  ...(scores ? { awayScore: scores[0], homeScore: scores[1] } : {}),
});

void describe("live-sync push rules (MX-004)", () => {
  void it("a kickoff and a final are transitions; a re-read and a first sighting are not", () => {
    const before = [{ providerEventId: "4015", status: "scheduled" }];
    assert.deepEqual(gameTransitions(before, [game("scheduled")]), []);
    const kick = gameTransitions(before, [game("in_progress")]);
    assert.equal(kick.length, 1);
    assert.equal(kick[0].phase, "kickoff");
    assert.deepEqual(gameTransitions([], [game("in_progress")]), [], "unknown before → nothing");
    const fin = gameTransitions(
      [{ providerEventId: "4015", status: "in_progress" }],
      [game("final", [27, 20])],
    );
    assert.equal(fin[0].phase, "final");
    assert.deepEqual(
      gameTransitions([{ providerEventId: "4015", status: "final" }], [game("final")]),
      [],
    );
    assert.deepEqual(gameEventFor(fin[0], "nfl"), {
      kind: "game_event",
      phase: "final",
      league: "nfl",
      eventId: "4015",
      away: "Kansas City Chiefs",
      home: "Las Vegas Raiders",
      awayScore: 27,
      homeScore: 20,
    });
  });

  void it("alerts once per 10¢ step from entry, in the held side's own price", () => {
    const yesHome: HeldPosition = {
      userId: "u1",
      marketId: "0xm",
      side: "yes",
      outcomeIndex: 0,
      entryPrice: 0.5,
      league: "nfl",
      providerEventId: "4015",
      homeTeam: "Las Vegas Raiders",
      awayTeam: "Kansas City Chiefs",
    };
    const price = (p: number) => new Map([["0xm", p]]);
    assert.deepEqual(positionAlerts([yesHome], price(0.57)), [], "7¢ is under a step");
    const up = positionAlerts([yesHome], price(0.62));
    assert.equal(up.length, 1);
    assert.equal(up[0].userId, "u1");
    if (up[0].event.kind === "position_alert") {
      assert.equal(up[0].event.bucket, 1);
      assert.equal(up[0].event.priceCents, 62);
      assert.equal(up[0].event.entryCents, 50);
      assert.equal(up[0].event.team, "Las Vegas Raiders");
      assert.equal(up[0].event.side, 0);
    }
    const down = positionAlerts([yesHome], price(0.28));
    if (down[0].event.kind === "position_alert") assert.equal(down[0].event.bucket, -2);

    // Holding NO on the home market means holding the away team: the
    // alert is priced from the away side and points at that side's page.
    const noHome: HeldPosition = { ...yesHome, side: "no" };
    const noUp = positionAlerts([noHome], price(0.38));
    if (noUp[0].event.kind === "position_alert") {
      assert.equal(noUp[0].event.side, 1);
      assert.equal(noUp[0].event.team, "Kansas City Chiefs");
      assert.equal(noUp[0].event.priceCents, 62);
      assert.equal(noUp[0].event.bucket, 1);
    }
    assert.deepEqual(positionAlerts([{ ...yesHome, entryPrice: null }], price(0.9)), []);
    assert.deepEqual(positionAlerts([yesHome], new Map()), [], "no pool price → no alert");
  });
});
