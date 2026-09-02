import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideSettlement, planMarkets, planSlate, refreshSlate } from "./ingest.ts";
import { computeMarketId } from "../market-id.ts";
import type { LeagueSlug, ProviderEvent, ProviderSlate, SportsDataProvider } from "./provider.ts";

const NOW = 1_800_000_000;

function event(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    providerEventId: "401671789",
    league: "nfl",
    startsAt: NOW + 3600,
    status: "scheduled",
    home: { providerId: "1", key: "nfl:KC", name: "KC Team", abbreviation: "KC" },
    away: { providerId: "2", key: "nfl:LV", name: "LV Team", abbreviation: "LV" },
    ...overrides,
  };
}

void describe("planMarkets (B3-006)", () => {
  void it("plans two moneyline markets per scheduled game — one per side", () => {
    const markets = planMarkets(event({ homeWinProbabilityBps: 6200 }), NOW);
    assert.equal(markets.length, 2);

    const [home, away] = markets;
    assert.equal(home.outcomeIndex, 0);
    assert.equal(home.label, "KC to win");
    assert.equal(away.outcomeIndex, 1);
    assert.equal(away.label, "LV to win");
  });

  void it("prices the two sides as complements so they open consistently", () => {
    const [home, away] = planMarkets(event({ homeWinProbabilityBps: 6200 }), NOW);
    assert.ok(Math.abs(home.openingProbability - 0.62) < 1e-9);
    assert.ok(Math.abs(away.openingProbability - 0.38) < 1e-9);
  });

  void it("defaults to 50/50 when the provider publishes no odds", () => {
    const [home, away] = planMarkets(event(), NOW);
    assert.equal(home.openingProbability, 0.5);
    assert.equal(away.openingProbability, 0.5);
  });

  void it("derives ids from the shared market-id module, so planning is deterministic", () => {
    const [home] = planMarkets(event(), NOW);
    assert.equal(
      home.marketId,
      computeMarketId({ providerEventId: "401671789", marketType: "moneyline", outcomeIndex: 0 }),
    );
    // Re-planning yields byte-identical ids — the property that makes the
    // generator safe to re-run (B0-004).
    assert.deepEqual(planMarkets(event(), NOW), planMarkets(event(), NOW));
  });

  void it("plans nothing for a game already started, finished, or called off", () => {
    // MarketFactory rejects kickoff <= now, so planning these would only
    // generate guaranteed reverts.
    assert.equal(planMarkets(event({ startsAt: NOW }), NOW).length, 0);
    assert.equal(planMarkets(event({ startsAt: NOW - 60 }), NOW).length, 0);
    assert.equal(planMarkets(event({ status: "in_progress" }), NOW).length, 0);
    assert.equal(planMarkets(event({ status: "final" }), NOW).length, 0);
    assert.equal(planMarkets(event({ status: "postponed" }), NOW).length, 0);
    assert.equal(planMarkets(event({ status: "unknown" }), NOW).length, 0);
  });

  void it("planSlate flattens across events", () => {
    const events = [event({ providerEventId: "1" }), event({ providerEventId: "2" })];
    assert.equal(planSlate(events, NOW).length, 4);
  });
});

void describe("decideSettlement (B3-005 final capture)", () => {
  void it("resolves a decisive final — home win is outcome 0, away win is 1", () => {
    const homeWin = decideSettlement(
      event({ status: "final", homeScore: 27, awayScore: 20 }),
      false,
    );
    assert.deepEqual(homeWin, {
      kind: "resolve",
      providerEventId: "401671789",
      winningOutcomeIndex: 0,
    });

    const awayWin = decideSettlement(
      event({ status: "final", homeScore: 13, awayScore: 20 }),
      false,
    );
    assert.deepEqual(awayWin, {
      kind: "resolve",
      providerEventId: "401671789",
      winningOutcomeIndex: 1,
    });
  });

  void it("voids a postponed or cancelled game", () => {
    assert.equal(decideSettlement(event({ status: "postponed" }), false).kind, "void");
    assert.equal(decideSettlement(event({ status: "cancelled" }), false).kind, "void");
  });

  void it("voids a tie — neither binary market's YES is true", () => {
    const action = decideSettlement(
      event({ status: "final", homeScore: 20, awayScore: 20 }),
      false,
    );
    assert.equal(action.kind, "void");
  });

  void it("never settles on delayed data, even a clean final", () => {
    // The load-bearing rule: a degraded read can be arbitrarily stale, and a
    // wrong settlement is unrecoverable on-chain (spec §3.5).
    const action = decideSettlement(event({ status: "final", homeScore: 27, awayScore: 20 }), true);
    assert.equal(action.kind, "wait");
  });

  void it("still voids on delayed data — void returns collateral, it cannot pick a wrong winner", () => {
    const action = decideSettlement(event({ status: "postponed" }), true);
    assert.equal(action.kind, "void");
  });

  void it("waits on a final missing either score", () => {
    assert.equal(decideSettlement(event({ status: "final", homeScore: 27 }), false).kind, "wait");
    assert.equal(decideSettlement(event({ status: "final", awayScore: 20 }), false).kind, "wait");
  });

  void it("waits on in-progress, scheduled, and unknown statuses", () => {
    assert.equal(
      decideSettlement(event({ status: "in_progress", homeScore: 3, awayScore: 0 }), false).kind,
      "wait",
    );
    assert.equal(decideSettlement(event({ status: "scheduled" }), false).kind, "wait");
    // "unknown" is an unrecognised provider string — absence of information
    // must never resolve a market.
    assert.equal(
      decideSettlement(event({ status: "unknown", homeScore: 27, awayScore: 20 }), false).kind,
      "wait",
    );
  });
});

void describe("refreshSlate (B3-005)", () => {
  function stubProvider(slate: Partial<ProviderSlate>): SportsDataProvider {
    return {
      name: "stub",
      leagues: ["nfl"],
      getSlate: (league: LeagueSlug) =>
        Promise.resolve({
          provider: "stub",
          league,
          events: [event()],
          delayed: false,
          fetchedAt: Date.now(),
          ...slate,
        }),
      getEvent: () => Promise.resolve(null),
    };
  }

  void it("reads the slate and plans its markets", async () => {
    const result = await refreshSlate(stubProvider({}), "nfl", NOW);
    assert.equal(result.events.length, 1);
    assert.equal(result.marketsPlanned.length, 2);
    assert.equal(result.delayed, false);
  });

  void it("still plans markets from a delayed slate, but propagates the flag", async () => {
    // Creating a market late is harmless and idempotent; the flag exists so
    // settlement (which is not harmless) can refuse.
    const result = await refreshSlate(stubProvider({ delayed: true }), "nfl", NOW);
    assert.equal(result.delayed, true);
    assert.equal(result.marketsPlanned.length, 2);
  });
});
