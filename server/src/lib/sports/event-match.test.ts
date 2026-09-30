/**
 * R-012 — cross-provider event identity, the pure matcher.
 *
 * The failure this guards: a second provider's slate inserting a twin row
 * for a game the first provider already persisted, which plans a second
 * market for the same game and shows it twice on the board.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  KICKOFF_MATCH_TOLERANCE_MS,
  findCanonicalMatch,
  providerIdFor,
  withProviderId,
  type MatchCandidate,
} from "./event-match.ts";

const KICKOFF = Date.UTC(2026, 9, 4, 17, 0, 0);

function row(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    id: "row-1",
    provider: "sportradar",
    providerEventId: "sr-uuid",
    homeTeamKey: "nfl:WAS",
    awayTeamKey: "nfl:IND",
    startsAt: new Date(KICKOFF),
    ...over,
  };
}

const incoming = {
  provider: "espn",
  providerEventId: "401772000",
  homeTeamKey: "nfl:WAS",
  awayTeamKey: "nfl:IND",
  startsAtMs: KICKOFF,
};

void describe("findCanonicalMatch", () => {
  void it("matches another provider's row for the same teams at the same kickoff", () => {
    assert.equal(findCanonicalMatch([row()], incoming)?.id, "row-1");
  });

  void it("tolerates a kickoff disagreement inside the window, not outside it", () => {
    const inside = row({ startsAt: new Date(KICKOFF + KICKOFF_MATCH_TOLERANCE_MS) });
    const outside = row({
      id: "far",
      startsAt: new Date(KICKOFF + KICKOFF_MATCH_TOLERANCE_MS + 1),
    });
    assert.equal(findCanonicalMatch([inside], incoming)?.id, "row-1");
    assert.equal(findCanonicalMatch([outside], incoming), null);
  });

  void it("never matches a row the incoming provider already owns — that is the primary identity", () => {
    assert.equal(findCanonicalMatch([row({ provider: "espn" })], incoming), null);
  });

  void it("requires both team keys in the same home/away order", () => {
    const flipped = row({ homeTeamKey: "nfl:IND", awayTeamKey: "nfl:WAS" });
    assert.equal(findCanonicalMatch([flipped], incoming), null);
    assert.equal(findCanonicalMatch([row({ awayTeamKey: "nfl:NYG" })], incoming), null);
    assert.equal(findCanonicalMatch([row({ homeTeamKey: null })], incoming), null);
  });

  void it("picks the closest kickoff when several rows qualify", () => {
    const near = row({ id: "near", startsAt: new Date(KICKOFF + 5 * 60_000) });
    const far = row({ id: "far", startsAt: new Date(KICKOFF + 40 * 60_000) });
    assert.equal(findCanonicalMatch([far, near], incoming)?.id, "near");
  });
});

void describe("providerIds bookkeeping", () => {
  void it("withProviderId records the describing provider's id and keeps the rest", () => {
    assert.deepEqual(withProviderId({ sportradar: "sr-uuid" }, "espn", "401772000"), {
      sportradar: "sr-uuid",
      espn: "401772000",
    });
    assert.deepEqual(withProviderId(null, "espn", "1"), { espn: "1" });
  });

  void it("providerIdFor answers the owner's id, a describer's id, or null", () => {
    const r = {
      provider: "sportradar",
      providerEventId: "sr-uuid",
      providerIds: { espn: "401772000" },
    };
    assert.equal(providerIdFor(r, "sportradar"), "sr-uuid");
    assert.equal(providerIdFor(r, "espn"), "401772000");
    assert.equal(providerIdFor(r, "other"), null);
  });
});
