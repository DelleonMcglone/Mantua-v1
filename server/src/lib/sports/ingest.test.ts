import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideSettlement,
  planCanonicalMarkets,
  planMarkets,
  planSlate,
  refreshSlate,
  type CanonicalPlannableEvent,
} from "./ingest.ts";
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

// ─── S-003: injury open/resolve planning ────────────────────────────────────

import {
  feedFreshnessSnapshot,
  planInjuryTransitions,
  recordFeedPoll,
  type OpenInjuryRow,
} from "./ingest.ts";
import type { ProviderInjuryReport } from "./provider.ts";

function report(overrides: Partial<ProviderInjuryReport> = {}): ProviderInjuryReport {
  return {
    providerPlayerId: "p1",
    playerName: "Pat Sample",
    teamKey: "nfl:KC",
    status: "questionable",
    description: "Hamstring",
    ...overrides,
  };
}

function openRow(overrides: Partial<OpenInjuryRow> = {}): OpenInjuryRow {
  return {
    id: "row-1",
    providerPlayerId: "p1",
    status: "questionable",
    description: "Hamstring",
    ...overrides,
  };
}

void describe("planInjuryTransitions (S-003)", () => {
  void it("opens a row for a first-seen report", () => {
    const plan = planInjuryTransitions([], [report()], false);
    assert.equal(plan.open.length, 1);
    assert.deepEqual(plan.resolve, []);
  });

  void it("touches, not duplicates, an unchanged report", () => {
    const plan = planInjuryTransitions([openRow()], [report()], false);
    assert.deepEqual(plan.touch, ["row-1"]);
    assert.equal(plan.open.length, 0);
    assert.deepEqual(plan.resolve, []);
  });

  void it("resolves the old row and opens a new one when the status changes", () => {
    // History is append-only: Questionable → Out is a resolve + open, so the
    // schema's "latest open row is the current status" convention holds.
    const plan = planInjuryTransitions([openRow()], [report({ status: "out" })], false);
    assert.deepEqual(plan.resolve, ["row-1"]);
    assert.equal(plan.open.length, 1);
    assert.equal(plan.open[0].status, "out");
  });

  void it("resolves a row whose player dropped off the report — they returned", () => {
    const plan = planInjuryTransitions([openRow()], [], false);
    assert.deepEqual(plan.resolve, ["row-1"]);
  });

  void it("plans NOTHING from a delayed feed — a stale list must not 'heal' players", () => {
    const plan = planInjuryTransitions([openRow()], [], true);
    assert.deepEqual(plan, { resolve: [], open: [], touch: [] });
  });

  void it("collapses duplicate open rows for one player onto the matching one", () => {
    const plan = planInjuryTransitions(
      [openRow(), openRow({ id: "row-2", status: "out", description: null })],
      [report()],
      false,
    );
    assert.deepEqual(plan.touch, ["row-1"]);
    assert.deepEqual(plan.resolve, ["row-2"]);
  });
});

void describe("feed freshness registry (S-003)", () => {
  void it("tracks lastPolledAt always, lastGoodAt only on fresh reads", () => {
    recordFeedPoll("injuries", "nfl", "sportradar", false, 1_000);
    recordFeedPoll("injuries", "nfl", "sportradar", true, 2_000);
    const snap = feedFreshnessSnapshot()["nfl:injuries"];
    assert.equal(snap.lastPolledAt, 2_000);
    assert.equal(snap.lastGoodAt, 1_000); // the delayed poll did not advance it
    assert.equal(snap.delayed, true);
  });
});

// ─── Task 041: pbp target selection + planners ──────────────────────────────

import {
  PBP_FINAL_GRACE_SECONDS,
  planGamePlayRows,
  planTeamRecordRows,
  selectPbpTargets,
  type PbpCandidateRow,
} from "./ingest.ts";
import type { ProviderPlay, ProviderTeamStanding } from "./provider.ts";

function candidate(overrides: Partial<PbpCandidateRow> = {}): PbpCandidateRow {
  return { providerEventId: "e-1", status: "in_progress", startsAt: NOW - 3_600, ...overrides };
}

void describe("selectPbpTargets (041 quota rule)", () => {
  void it("includes live games and just-finished finals, never scheduled games", () => {
    const targets = selectPbpTargets(
      [
        candidate({ providerEventId: "live" }),
        candidate({ providerEventId: "sched", status: "scheduled", startsAt: NOW + 3_600 }),
        candidate({ providerEventId: "fresh-final", status: "final", startsAt: NOW - 4 * 3_600 }),
        candidate({ providerEventId: "postponed", status: "postponed" }),
      ],
      NOW,
      10,
    );
    assert.deepEqual(
      targets.map((t) => t.providerEventId),
      ["live", "fresh-final"],
    );
  });

  void it("excludes finals older than the just-finished grace window", () => {
    const targets = selectPbpTargets(
      [
        candidate({
          providerEventId: "old-final",
          status: "final",
          startsAt: NOW - PBP_FINAL_GRACE_SECONDS - 1,
        }),
        candidate({ providerEventId: "fresh-final", status: "final", startsAt: NOW - 3_600 }),
      ],
      NOW,
      10,
    );
    assert.deepEqual(
      targets.map((t) => t.providerEventId),
      ["fresh-final"],
    );
  });

  void it("caps the per-tick spend, live games first", () => {
    const targets = selectPbpTargets(
      [
        candidate({ providerEventId: "final-a", status: "final", startsAt: NOW - 2 * 3_600 }),
        candidate({ providerEventId: "live-late", startsAt: NOW - 1_800 }),
        candidate({ providerEventId: "live-early", startsAt: NOW - 7_200 }),
        candidate({ providerEventId: "final-b", status: "final", startsAt: NOW - 3 * 3_600 }),
      ],
      NOW,
      2,
    );
    // Both slots go to live games (oldest kickoff first — closest to done).
    assert.deepEqual(
      targets.map((t) => t.providerEventId),
      ["live-early", "live-late"],
    );
    assert.deepEqual(selectPbpTargets([candidate()], NOW, 0), []);
  });
});

void describe("planGamePlayRows (041)", () => {
  const play = (overrides: Partial<ProviderPlay> = {}): ProviderPlay => ({
    sequence: 1_698_611_000_000,
    period: 1,
    clock: "15:00",
    playType: "kickoff",
    description: "kickoff",
    teamKey: "nfl:LV",
    scoringPlay: false,
    homeScore: 0,
    awayScore: 0,
    ...overrides,
  });

  void it("maps plays onto stable (event, provider, sequence) rows — re-ingest is a no-op", () => {
    const plays = [play(), play({ sequence: 1_698_611_137_531, scoringPlay: true })];
    const first = planGamePlayRows("ev-uuid", "sportradar", plays);
    const second = planGamePlayRows("ev-uuid", "sportradar", plays);
    assert.deepEqual(first, second); // identical rows → onConflictDoNothing no-op
    assert.equal(first.length, 2);
    assert.deepEqual(
      first.map((r) => [r.eventId, r.provider, r.sequence]),
      [
        ["ev-uuid", "sportradar", 1_698_611_000_000],
        ["ev-uuid", "sportradar", 1_698_611_137_531],
      ],
    );
  });

  void it("collapses duplicate sequences (last wins) so a batch cannot self-conflict", () => {
    const rows = planGamePlayRows("ev", "sportradar", [
      play({ description: "first version" }),
      play({ description: "corrected version" }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].description, "corrected version");
  });
});

void describe("planTeamRecordRows (041)", () => {
  const standing = (overrides: Partial<ProviderTeamStanding> = {}): ProviderTeamStanding => ({
    providerTeamId: "sr-kc",
    teamKey: "nfl:KC",
    season: "2026",
    seasonType: "regular",
    wins: 11,
    losses: 6,
    ties: 0,
    divisionRank: 1,
    streak: "W3",
    homeRecord: "6-2",
    awayRecord: "5-4",
    stats: { win_pct: 0.647 },
    ...overrides,
  });

  void it("maps standings onto team_records upserts, skipping teams not yet canonical", () => {
    const plan = planTeamRecordRows(
      [standing(), standing({ teamKey: "nfl:LV", providerTeamId: "sr-lv" })],
      new Map([["nfl:KC", "team-uuid-kc"]]),
      false,
    );
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.skippedUnknownTeams, 1); // heals on the next hierarchy pass
    assert.deepEqual(plan.rows[0], {
      teamId: "team-uuid-kc",
      season: "2026",
      seasonType: "regular",
      wins: 11,
      losses: 6,
      ties: 0,
      divisionRank: 1,
      conferenceRank: null,
      pointsFor: null,
      pointsAgainst: null,
      streak: "W3",
      homeRecord: "6-2",
      awayRecord: "5-4",
      stats: { win_pct: 0.647 },
    });
  });

  void it("plans NOTHING from a delayed feed — stale standings must not overwrite fresh ones", () => {
    const plan = planTeamRecordRows([standing()], new Map([["nfl:KC", "t"]]), true);
    assert.deepEqual(plan, { rows: [], skippedUnknownTeams: 0 });
  });
});

void describe("planCanonicalMarkets (task 046 / P-002 — plan from the persisted rows)", () => {
  function canonicalRow(
    overrides: Partial<CanonicalPlannableEvent> = {},
  ): CanonicalPlannableEvent {
    return {
      providerEventId: "401671789",
      status: "scheduled",
      startsAtSeconds: NOW + 3600,
      homeTeamKey: "nfl:KC",
      awayTeamKey: "nfl:LV",
      ...overrides,
    };
  }
  const feed = new Map([["401671789", event({ homeWinProbabilityBps: 6200 })]]);

  void it("plans the same two markets planMarkets would, from the canonical row", () => {
    const result = planCanonicalMarkets([canonicalRow()], feed, NOW);
    assert.equal(result.planned.length, 2);
    assert.deepEqual(
      result.planned,
      planMarkets(event({ homeWinProbabilityBps: 6200 }), NOW),
      "identity, labels, ids and opening odds all match the direct plan",
    );
  });

  void it("the persisted rows are the planning universe: an un-persisted feed game plans nothing", () => {
    const result = planCanonicalMarkets([], feed, NOW);
    assert.equal(result.planned.length, 0);
  });

  void it("a canonical game the feed dropped is skipped (counted), not planned blind", () => {
    const result = planCanonicalMarkets([canonicalRow()], new Map(), NOW);
    assert.equal(result.planned.length, 0);
    assert.equal(result.skippedNoFeed, 1);
  });

  void it("only scheduled, pre-kickoff canonical rows plan — same window as planMarkets", () => {
    for (const row of [
      canonicalRow({ status: "in_progress" }),
      canonicalRow({ status: "final" }),
      canonicalRow({ startsAtSeconds: NOW }),
      canonicalRow({ startsAtSeconds: NOW - 1 }),
    ]) {
      assert.equal(planCanonicalMarkets([row], feed, NOW).planned.length, 0);
    }
  });

  void it("the canonical row's clock wins over the feed's", () => {
    // Feed says kickoff moved an hour later; the persisted row is what the
    // planner anchors the market's kickoff timestamp on.
    const shifted = new Map([
      ["401671789", event({ startsAt: NOW + 7200, homeWinProbabilityBps: 6200 })],
    ]);
    const result = planCanonicalMarkets([canonicalRow()], shifted, NOW);
    assert.equal(result.planned[0].kickoffTimestamp, NOW + 3600);
  });

  void it("refuses a feed whose home/away contradicts the stored row — the outcome-index anchor", () => {
    const flipped = new Map([
      [
        "401671789",
        event({
          home: { providerId: "2", key: "nfl:LV", name: "LV Team", abbreviation: "LV" },
          away: { providerId: "1", key: "nfl:KC", name: "KC Team", abbreviation: "KC" },
        }),
      ],
    ]);
    const result = planCanonicalMarkets([canonicalRow()], flipped, NOW);
    assert.equal(result.planned.length, 0);
    assert.equal(result.skippedSideMismatch, 1);
  });

  void it("deterministic over the same rows + feed — re-running is a no-op through createMarketIfAbsent", () => {
    const a = planCanonicalMarkets([canonicalRow()], feed, NOW);
    const b = planCanonicalMarkets([canonicalRow()], feed, NOW);
    assert.deepEqual(a, b);
  });
});
