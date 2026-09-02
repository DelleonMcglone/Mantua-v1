import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OUTCOME_NO,
  OUTCOME_YES,
  executeResolution,
  marketActionsFor,
  marketIdsFor,
  planResolution,
  voidActionsFor,
  type ResolutionRecord,
  type ResolutionSubmitter,
} from "./resolution.ts";
import { computeMarketId } from "../market-id.ts";
import type { ProviderEvent, ProviderSlate } from "./provider.ts";

const NOW = 1_800_000_000;

function event(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    providerEventId: "401671789",
    league: "nfl",
    startsAt: NOW - 4 * 3600,
    status: "final",
    home: { providerId: "1", key: "nfl:KC", name: "KC Team", abbreviation: "KC" },
    away: { providerId: "2", key: "nfl:LV", name: "LV Team", abbreviation: "LV" },
    homeScore: 27,
    awayScore: 20,
    ...overrides,
  };
}

function slate(events: ProviderEvent[], delayed = false): ProviderSlate {
  return { provider: "espn", league: "nfl", events, delayed, fetchedAt: NOW * 1000 };
}

function fakeSubmitter(failOn: Set<string> = new Set()) {
  const calls: string[] = [];
  const submitter: ResolutionSubmitter = {
    signerAddress: () => "0xSIGNER",
    freeze: (id) => {
      calls.push(`freeze:${id.slice(0, 10)}`);
      return Promise.resolve(null);
    },
    resolve: (id, outcome) => {
      if (failOn.has(id)) return Promise.reject(new Error("revert"));
      calls.push(`resolve:${id.slice(0, 10)}:${String(outcome)}`);
      return Promise.resolve(`0xtx-${String(calls.length)}`);
    },
    void: (id) => {
      if (failOn.has(id)) return Promise.reject(new Error("revert"));
      calls.push(`void:${id.slice(0, 10)}`);
      return Promise.resolve(`0xtx-${String(calls.length)}`);
    },
  };
  return { submitter, calls };
}

function fakeLog() {
  const records: ResolutionRecord[] = [];
  return {
    records,
    log: {
      record: (entry: ResolutionRecord) => {
        records.push(entry);
        return Promise.resolve();
      },
    },
  };
}

void describe("marketActionsFor — the two-vocabulary mapping", () => {
  // The subtle core: game outcome 0 means "home won the game"; each market's
  // resolve outcome speaks about that market's own YES/NO pair.
  const [homeMarket, awayMarket] = marketIdsFor("401671789");

  void it("a home win resolves the home market YES and the away market NO", () => {
    const actions = marketActionsFor("401671789", 0);
    assert.deepEqual(
      actions.map((a) => [a.marketId, a.outcome]),
      [
        [homeMarket, OUTCOME_YES],
        [awayMarket, OUTCOME_NO],
      ],
    );
  });

  void it("an away win resolves the home market NO and the away market YES", () => {
    const actions = marketActionsFor("401671789", 1);
    assert.deepEqual(
      actions.map((a) => [a.marketId, a.outcome]),
      [
        [homeMarket, OUTCOME_NO],
        [awayMarket, OUTCOME_YES],
      ],
    );
  });

  void it("market ids come from the shared module in outcome-index order", () => {
    assert.equal(
      homeMarket,
      computeMarketId({ providerEventId: "401671789", marketType: "moneyline", outcomeIndex: 0 }),
    );
    assert.notEqual(homeMarket, awayMarket);
  });

  void it("a void hits both markets with no outcome", () => {
    const actions = voidActionsFor("401671789");
    assert.equal(actions.length, 2);
    assert.ok(actions.every((a) => a.kind === "void" && a.outcome === undefined));
  });
});

void describe("planResolution", () => {
  void it("settles a decisive final into four per-market words: two markets, right outcomes", () => {
    const plan = planResolution(slate([event()]), null, NOW);
    assert.equal(plan.submissions.length, 2);
    assert.equal(plan.held.length, 0);
    assert.deepEqual(
      plan.submissions.map((s) => s.outcome),
      [OUTCOME_YES, OUTCOME_NO],
    );
  });

  void it("voids both markets of a postponed game", () => {
    const plan = planResolution(slate([event({ status: "postponed" })]), null, NOW);
    assert.equal(plan.submissions.length, 2);
    assert.ok(plan.submissions.every((s) => s.kind === "void"));
  });

  void it("holds every final on a delayed slate", () => {
    const plan = planResolution(slate([event()], true), null, NOW);
    assert.equal(plan.submissions.length, 0);
    assert.equal(plan.held.length, 1);
  });

  void it("still voids on a delayed slate — void cannot pick a wrong winner", () => {
    const plan = planResolution(slate([event({ status: "postponed" })], true), null, NOW);
    assert.equal(plan.submissions.filter((s) => s.kind === "void").length, 2);
  });

  void it("sweeps freezes for games past kickoff, in play or not yet marked", () => {
    const plan = planResolution(
      slate([
        event({ providerEventId: "live", status: "in_progress", startsAt: NOW - 600 }),
        event({ providerEventId: "late-feed", status: "scheduled", startsAt: NOW - 60 }),
        event({ providerEventId: "future", status: "scheduled", startsAt: NOW + 3600 }),
      ]),
      null,
      NOW,
    );
    // Two games past kickoff × two markets each; the future game untouched.
    assert.equal(plan.freezes.length, 4);
  });

  void it("with a secondary configured, agreement settles", () => {
    const secondary = slate([event({ providerEventId: "other-id" })]);
    const plan = planResolution(slate([event()]), secondary, NOW);
    assert.equal(plan.submissions.length, 2);
  });

  void it("with a secondary configured, a winner mismatch holds — never a tiebreak", () => {
    const secondary = slate([event({ providerEventId: "other-id", homeScore: 20, awayScore: 27 })]);
    const plan = planResolution(slate([event()]), secondary, NOW);
    assert.equal(plan.submissions.length, 0);
    assert.equal(plan.held.length, 1);
    assert.match(plan.held[0].reason, /disagreed/);
  });

  void it("with a secondary configured, missing coverage holds rather than falling back", () => {
    // A configured check that silently skips itself is worse than no check.
    const secondary = slate([]);
    const plan = planResolution(slate([event()]), secondary, NOW);
    assert.equal(plan.submissions.length, 0);
    assert.match(plan.held[0].reason, /single-source/);
  });

  void it("holds an unknown status quietly but records finals that cannot settle", () => {
    const plan = planResolution(
      slate([
        event({
          providerEventId: "no-scores",
          homeScore: undefined as never,
          awayScore: undefined as never,
        }),
      ]),
      null,
      NOW,
    );
    assert.equal(plan.held.length, 1);
    assert.match(plan.held[0].reason, /without both scores/);
  });
});

void describe("executeResolution", () => {
  void it("submits, logs each action with signer and tx hash, and counts", async () => {
    const { submitter, calls } = fakeSubmitter();
    const { log, records } = fakeLog();

    const plan = planResolution(slate([event()]), null, NOW);
    const summary = await executeResolution(plan, submitter, log, "espn");

    assert.equal(summary.resolved, 2);
    assert.equal(summary.failures.length, 0);
    assert.equal(records.length, 2);
    assert.equal(records[0].signer, "0xSIGNER");
    assert.equal(records[0].source, "espn");
    assert.match(records[0].txHash, /^0xtx-/);
    assert.equal(calls.filter((c) => c.startsWith("resolve:")).length, 2);
  });

  void it("isolates a failing market — the rest of the slate still settles", async () => {
    const [homeMarket] = marketIdsFor("401671789");
    const { submitter } = fakeSubmitter(new Set([homeMarket]));
    const { log, records } = fakeLog();

    const plan = planResolution(slate([event()]), null, NOW);
    const summary = await executeResolution(plan, submitter, log, "espn");

    assert.equal(summary.resolved, 1, "the away market still settled");
    assert.equal(summary.failures.length, 1);
    assert.equal(records.length, 1, "no log row for the failed submission");
  });

  void it("nothing is logged without a tx hash — the log records what happened, not what was hoped", async () => {
    const [homeMarket, awayMarket] = marketIdsFor("401671789");
    const { submitter } = fakeSubmitter(new Set([homeMarket, awayMarket]));
    const { log, records } = fakeLog();

    const plan = planResolution(slate([event()]), null, NOW);
    const summary = await executeResolution(plan, submitter, log, "espn");

    assert.equal(summary.resolved, 0);
    assert.equal(records.length, 0);
  });

  void it("freeze sweep counts and tolerates already-frozen markets", async () => {
    const { submitter } = fakeSubmitter();
    const { log } = fakeLog();
    const plan = planResolution(
      slate([event({ providerEventId: "live", status: "in_progress", startsAt: NOW - 600 })]),
      null,
      NOW,
    );
    const summary = await executeResolution(plan, submitter, log, "espn");
    assert.equal(summary.frozen, 2);
  });
});

void describe("B10-004 — provider outage mid-game", () => {
  // The outage scenario: the game kicked off, then the data provider went
  // down. The resilience layer stale-serves the last slate flagged
  // `delayed`. The correct behaviour is asymmetric: the freeze (safety)
  // still happens — it is timestamp-driven and cannot be wrong — while
  // settlement (irreversible) waits for fresh data, even if the stale
  // cache happens to contain a "final".
  void it("still freezes on delayed data, but never settles from it", () => {
    const outage = slate(
      [
        event({ providerEventId: "live-game", status: "in_progress", startsAt: NOW - 1800 }),
        // Stale cache captured a final just before the outage.
        event({ providerEventId: "finished-game", startsAt: NOW - 4 * 3600 }),
      ],
      true, // delayed — served from a stale cache or open breaker
    );
    const plan = planResolution(outage, null, NOW);

    // Freeze: yes — the in-play game's markets stop trading.
    assert.equal(plan.freezes.length, 2, "both markets of the live game freeze");
    // Settle: no — the cached final is held, loudly, until data is fresh.
    assert.equal(plan.submissions.length, 0, "nothing settles on delayed data");
    assert.equal(plan.held.length, 1);
    assert.equal(plan.held[0].providerEventId, "finished-game");
  });

  void it("recovery: the same slate served fresh settles normally", () => {
    const recovered = slate([event({ providerEventId: "finished-game" })], false);
    const plan = planResolution(recovered, null, NOW);
    assert.equal(plan.submissions.length, 2, "fresh data resolves both markets");
    assert.equal(plan.held.length, 0);
  });
});
