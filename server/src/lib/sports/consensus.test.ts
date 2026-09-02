import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SecondaryProvider,
  corroborate,
  parseGenericEvent,
  parseGenericSlate,
} from "./consensus.ts";
import { ProviderShapeError, type ProviderEvent } from "./provider.ts";

function primaryEvent(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    providerEventId: "401671789",
    league: "nfl",
    startsAt: 1_800_000_000,
    status: "final",
    home: { providerId: "1", key: "nfl:KC", name: "KC Team", abbreviation: "KC" },
    away: { providerId: "2", key: "nfl:LV", name: "LV Team", abbreviation: "LV" },
    homeScore: 27,
    awayScore: 20,
    ...overrides,
  };
}

function secondaryEvent(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  // Different provider ids for the same teams — matching happens on the
  // provider-agnostic key, which is the point of B3-004.
  return {
    providerEventId: "sec-99",
    league: "nfl",
    startsAt: 1_800_000_000,
    status: "final",
    home: { providerId: "KC", key: "nfl:KC", name: "KC", abbreviation: "KC" },
    away: { providerId: "LV", key: "nfl:LV", name: "LV", abbreviation: "LV" },
    homeScore: 27,
    awayScore: 20,
    ...overrides,
  };
}

void describe("corroborate (B3-008)", () => {
  void it("agrees when both providers report the same winner", () => {
    const result = corroborate(primaryEvent(), secondaryEvent());
    assert.deepEqual(result, { kind: "agreed", winningOutcomeIndex: 0 });
  });

  void it("agrees on the winner even when the exact scores differ", () => {
    // A corrected stat line can move a score without changing the winner; the
    // winner is what settles a moneyline, so trivia must not escalate.
    const result = corroborate(primaryEvent(), secondaryEvent({ homeScore: 28, awayScore: 20 }));
    assert.equal(result.kind, "agreed");
  });

  void it("escalates when the providers disagree on the winner", () => {
    const result = corroborate(primaryEvent(), secondaryEvent({ homeScore: 20, awayScore: 27 }));
    assert.equal(result.kind, "disagreed");
    // Disagreement is NOT a tiebreak toward the primary — it means one of two
    // sources is wrong about a result, and a human decides which.
  });

  void it("escalates when the providers describe different teams", () => {
    const result = corroborate(
      primaryEvent(),
      secondaryEvent({
        home: { providerId: "DEN", key: "nfl:DEN", name: "DEN", abbreviation: "DEN" },
      }),
    );
    assert.equal(result.kind, "disagreed");
  });

  void it("is single-source when the secondary does not know the event", () => {
    const result = corroborate(primaryEvent(), null);
    assert.equal(result.kind, "single-source");
  });

  void it("is single-source until both providers are final", () => {
    const result = corroborate(primaryEvent(), secondaryEvent({ status: "in_progress" }));
    assert.equal(result.kind, "single-source");
  });

  void it("is single-source when a final lacks a decisive score", () => {
    const { homeScore: _dropped, ...scoreless } = primaryEvent();
    assert.equal(corroborate(scoreless as ProviderEvent, secondaryEvent()).kind, "single-source");
    // A tie is not decisive either — the void path handles it, not consensus.
    assert.equal(
      corroborate(primaryEvent({ homeScore: 20, awayScore: 20 }), secondaryEvent()).kind,
      "single-source",
    );
  });

  void it("reports an away win as outcome index 1", () => {
    const result = corroborate(
      primaryEvent({ homeScore: 13, awayScore: 24 }),
      secondaryEvent({ homeScore: 13, awayScore: 24 }),
    );
    assert.deepEqual(result, { kind: "agreed", winningOutcomeIndex: 1 });
  });
});

void describe("parseGenericEvent / parseGenericSlate (B3-007)", () => {
  const raw = {
    id: "g1",
    home: "KC",
    away: "LV",
    startsAt: 1_800_000_000,
    status: "final",
    homeScore: 27,
    awayScore: 20,
  };

  void it("normalises the flat shape into a ProviderEvent", () => {
    const e = parseGenericEvent(raw, "nfl");
    assert.equal(e.providerEventId, "g1");
    assert.equal(e.home.key, "nfl:KC");
    assert.equal(e.status, "final");
    assert.equal(e.homeScore, 27);
  });

  void it("maps an unrecognised status to unknown, never to final", () => {
    const e = parseGenericEvent({ ...raw, status: "wrapping_up" }, "nfl");
    assert.equal(e.status, "unknown");
  });

  void it("rejects rows missing id, teams, or start time", () => {
    assert.throws(() => parseGenericEvent({ ...raw, id: "" }, "nfl"), ProviderShapeError);
    assert.throws(() => parseGenericEvent({ ...raw, home: "" }, "nfl"), ProviderShapeError);
    assert.throws(() => parseGenericEvent({ ...raw, startsAt: "soon" }, "nfl"), ProviderShapeError);
  });

  void it("skips malformed rows without losing the slate", () => {
    const events = parseGenericSlate({ games: [raw, { id: "junk" }, { ...raw, id: "g2" }] }, "nfl");
    assert.deepEqual(
      events.map((e) => e.providerEventId),
      ["g1", "g2"],
    );
  });

  void it("throws when there is no games array at all", () => {
    assert.throws(() => parseGenericSlate({}, "nfl"), ProviderShapeError);
  });
});

void describe("SecondaryProvider", () => {
  void it("fetches through the configured path builder", async () => {
    const urls: string[] = [];
    const fake: typeof fetch = (input) => {
      urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            games: [
              {
                id: "g1",
                home: "KC",
                away: "LV",
                startsAt: 1,
                status: "final",
                homeScore: 1,
                awayScore: 0,
              },
            ],
          }),
          {
            status: 200,
          },
        ),
      );
    };

    const provider = new SecondaryProvider(
      { name: "acme", hosts: ["https://scores.example"], pathFor: (l) => `/v1/${l}` },
      fake,
    );
    const slate = await provider.getSlate("nfl");

    assert.equal(urls[0], "https://scores.example/v1/nfl");
    assert.equal(slate.provider, "acme");
    assert.equal(slate.events.length, 1);
  });
});
