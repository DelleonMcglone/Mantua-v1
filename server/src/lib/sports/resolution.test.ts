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
import { MAX_EVENT_DURATION_SECONDS } from "./provider.ts";
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
    // S-025: resolve only accepts an authorization minted by the criteria
    // gate — there is no way to hand this fake a bare (marketId, outcome).
    resolve: (auth) => {
      if (failOn.has(auth.marketId)) return Promise.reject(new Error("revert"));
      calls.push(`resolve:${auth.marketId.slice(0, 10)}:${String(auth.outcome)}`);
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

  // ─── D-103 freeze sweep (task 047) ──────────────────────────────────────
  //
  // The owner's in-play decision moved the close from kickoff to the data.
  // These four tests are the whole rule: kickoff freezes NOTHING, a final
  // freezes, the 12 h backstop freezes a game whose final never arrived, and
  // a game that has not started is never touched.

  void it("never freezes a game that is merely past kickoff — trading runs through the event", () => {
    const plan = planResolution(
      slate([
        event({ providerEventId: "live", status: "in_progress", startsAt: NOW - 600 }),
        event({ providerEventId: "deep-in-play", status: "in_progress", startsAt: NOW - 3 * 3600 }),
        // Kicked off, feed has not flipped the status yet — still not closed.
        event({ providerEventId: "late-feed", status: "scheduled", startsAt: NOW - 60 }),
      ]),
      null,
      NOW,
    );
    assert.equal(plan.freezes.length, 0, "in-play markets stay open (D-103)");
  });

  void it("freezes both markets of a game that has gone final — the data-driven close", () => {
    const plan = planResolution(
      slate([event({ providerEventId: "done", status: "final", startsAt: NOW - 4 * 3600 })]),
      null,
      NOW,
    );
    assert.deepEqual(plan.freezes, [...marketIdsFor("done")]);
  });

  void it("freezes a stale in-progress game once the 12 h backstop elapses", () => {
    const plan = planResolution(
      slate([
        // The feed never reported the final; the backstop closes it anyway.
        event({
          providerEventId: "zombie",
          status: "in_progress",
          startsAt: NOW - MAX_EVENT_DURATION_SECONDS,
        }),
        // One second short of the backstop: still in play.
        event({
          providerEventId: "still-live",
          status: "in_progress",
          startsAt: NOW - MAX_EVENT_DURATION_SECONDS + 1,
        }),
      ]),
      null,
      NOW,
    );
    assert.deepEqual(plan.freezes, [...marketIdsFor("zombie")]);
  });

  void it("never freezes before kickoff — the contract's early window is resolver-only from startsAt", () => {
    const plan = planResolution(
      slate([
        event({ providerEventId: "future", status: "scheduled", startsAt: NOW + 3600 }),
        // Bad data: a "final" for a game that has not started. Freezing it
        // would revert on-chain (Market.freeze is closed before startsAt).
        event({ providerEventId: "impossible", status: "final", startsAt: NOW + 3600 }),
      ]),
      null,
      NOW,
    );
    assert.equal(plan.freezes.length, 0);
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
    const summary = await executeResolution(plan, submitter, log, "espn", { nowSeconds: NOW });

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
    const summary = await executeResolution(plan, submitter, log, "espn", { nowSeconds: NOW });

    assert.equal(summary.resolved, 1, "the away market still settled");
    assert.equal(summary.failures.length, 1);
    assert.equal(records.length, 1, "no log row for the failed submission");
  });

  void it("nothing is logged without a tx hash — the log records what happened, not what was hoped", async () => {
    const [homeMarket, awayMarket] = marketIdsFor("401671789");
    const { submitter } = fakeSubmitter(new Set([homeMarket, awayMarket]));
    const { log, records } = fakeLog();

    const plan = planResolution(slate([event()]), null, NOW);
    const summary = await executeResolution(plan, submitter, log, "espn", { nowSeconds: NOW });

    assert.equal(summary.resolved, 0);
    assert.equal(records.length, 0);
  });

  void it("freeze sweep counts and tolerates already-frozen markets", async () => {
    const { submitter } = fakeSubmitter();
    const { log } = fakeLog();
    // The fake's freeze resolves null for every call — exactly what the live
    // submitter does for an already-frozen market. Both still count.
    const plan = planResolution(
      slate([
        event({
          providerEventId: "zombie",
          status: "in_progress",
          startsAt: NOW - MAX_EVENT_DURATION_SECONDS,
        }),
      ]),
      null,
      NOW,
    );
    const summary = await executeResolution(plan, submitter, log, "espn", { nowSeconds: NOW });
    assert.equal(summary.frozen, 2);
  });

  void it("a resolve still freezes first — the Resolver refuses an unfrozen market", async () => {
    // S-025's `market_frozen` criterion plus the on-chain precondition: the
    // executor sweeps the freeze in-line before every submission, so a final
    // that arrived between sweeps can never resolve from OPEN.
    const { submitter, calls } = fakeSubmitter();
    const { log } = fakeLog();
    const plan = planResolution(slate([event()]), null, NOW);
    const summary = await executeResolution(plan, submitter, log, "espn", { nowSeconds: NOW });

    assert.equal(summary.resolved, 2);
    for (const marketId of marketIdsFor("401671789")) {
      const short = marketId.slice(0, 10);
      const firstFreeze = calls.indexOf(`freeze:${short}`);
      const resolveAt = calls.findIndex((c) => c.startsWith(`resolve:${short}`));
      assert.ok(firstFreeze >= 0, "the market was frozen");
      assert.ok(firstFreeze < resolveAt, "freeze precedes resolve for this market");
    }
    // And the plan itself already carried the freeze: the game is final.
    assert.equal(plan.freezes.length, 2);
  });
});

void describe("B10-004 — provider outage mid-game", () => {
  // The outage scenario: the game kicked off, then the data provider went
  // down. The resilience layer stale-serves the last slate flagged
  // `delayed`. The correct behaviour is asymmetric: the freeze (safety)
  // still happens — finality is monotonic, so a stale "final" was true when
  // it was fetched and cannot close a market that is still live — while
  // settlement (irreversible) waits for fresh data.
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

    // Freeze: the FINISHED game's markets close (D-103 — the close follows
    // the data, not the clock); the game still in play keeps trading.
    assert.deepEqual(plan.freezes, [...marketIdsFor("finished-game")]);
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

// ─── Task 040 — criteria gate at the executor (S-025) ──────────────────────

void describe("S-025 — executeResolution routes every resolve through the criteria gate", () => {
  void it("a DISPUTED review blocks resolution even when today's slate agrees", async () => {
    // An earlier pass recorded a provider disagreement; the review row is
    // DISPUTED. Today both sources happen to agree — the market must STILL
    // not resolve: disputes exit through a human, never through luck.
    const { submitter, calls } = fakeSubmitter();
    const { log, records } = fakeLog();
    const plan = planResolution(slate([event()]), null, NOW);

    const summary = await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW,
      confidenceOf: () => "DISPUTED",
    });

    assert.equal(summary.resolved, 0);
    assert.equal(summary.rejected.length, 2);
    assert.equal(records.length, 0, "no log rows for refused resolves");
    assert.ok(calls.every((c) => !c.startsWith("resolve:")), "submitter.resolve never called");
    assert.ok(
      summary.rejected[0].failed.some((c) => c.name === "confidence_verified"),
      "the confidence criterion is the one that failed",
    );
  });

  void it("the stale-feed breaker trips at execution time (S-022)", async () => {
    // The plan was built from a slate fetched long before the executor runs
    // (e.g. a wedged sweep resumed late). The gate re-checks freshness at
    // submission time and refuses.
    const { submitter } = fakeSubmitter();
    const { log, records } = fakeLog();
    const plan = planResolution(slate([event()]), null, NOW);

    const summary = await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW + 10 * 60, // slate.fetchedAt is 10 minutes stale by now
    });

    assert.equal(summary.resolved, 0);
    assert.equal(summary.rejected.length, 2);
    assert.equal(records.length, 0);
    assert.ok(summary.rejected[0].failed.some((c) => c.name === "feed_fresh"));
  });

  void it("a final reported implausibly soon after kickoff is refused", async () => {
    const fresh = slate([event({ startsAt: NOW - 600 })]); // "final" 10min in
    const { submitter } = fakeSubmitter();
    const { log } = fakeLog();
    const plan = planResolution(fresh, null, NOW);

    const summary = await executeResolution(plan, submitter, log, "espn", { nowSeconds: NOW });

    assert.equal(summary.resolved, 0);
    assert.ok(summary.rejected[0].failed.some((c) => c.name === "kickoff_elapsed"));
  });

  void it("a tampered outcome is caught by the independent mapping re-derivation", async () => {
    const { submitter } = fakeSubmitter();
    const { log, records } = fakeLog();
    const plan = planResolution(slate([event()]), null, NOW);
    // Corrupt the plan the way a planner bug would: flip one outcome.
    plan.submissions[0].outcome = OUTCOME_NO; // scores say home won → YES

    const summary = await executeResolution(plan, submitter, log, "espn", { nowSeconds: NOW });

    assert.equal(summary.resolved, 1, "the untampered market still settles");
    assert.equal(summary.rejected.length, 1);
    assert.ok(summary.rejected[0].failed.some((c) => c.name === "outcome_mapping"));
    assert.equal(records.length, 1);
  });

  void it("a resolve submission without settlement context is refused", async () => {
    const { submitter } = fakeSubmitter();
    const { log, records } = fakeLog();
    const plan = planResolution(slate([event()]), null, NOW);
    delete plan.submissions[0].context;

    const summary = await executeResolution(plan, submitter, log, "espn", { nowSeconds: NOW });

    assert.equal(summary.resolved, 1);
    assert.equal(summary.rejected.length, 1);
    assert.equal(records.length, 1);
  });

  void it("a stored-event contradiction fails the reconciliation precheck", async () => {
    const { submitter } = fakeSubmitter();
    const { log } = fakeLog();
    const plan = planResolution(slate([event()]), null, NOW);

    const summary = await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW,
      // Ingest recorded the same game final with the OPPOSITE winner.
      storedEventOf: () => ({
        status: "final",
        homeScore: 20,
        awayScore: 27,
        lastPolledAt: new Date(NOW * 1000 - 60_000),
      }),
    });

    assert.equal(summary.resolved, 0);
    assert.equal(summary.rejected.length, 2);
    assert.ok(summary.rejected[0].failed.some((c) => c.name === "store_reconciled"));
  });

  void it("rejections invoke onRejected with the failed criteria (audit hook)", async () => {
    const { submitter } = fakeSubmitter();
    const { log } = fakeLog();
    const plan = planResolution(slate([event()]), null, NOW);
    const seen: string[][] = [];

    await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW,
      confidenceOf: () => "MANUAL_REVIEW",
      onRejected: (r) => {
        seen.push(r.failed.map((c) => c.name));
      },
    });

    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0], ["confidence_verified"]);
  });

  void it("voids bypass the gate — returning collateral cannot pick a wrong winner", async () => {
    const { submitter } = fakeSubmitter();
    const { log, records } = fakeLog();
    // Delayed slate: resolves are impossible, voids still go (B4-005).
    const plan = planResolution(slate([event({ status: "cancelled" })], true), null, NOW);

    const summary = await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW + 20 * 60, // stale by every measure
    });

    assert.equal(summary.voided, 2);
    assert.equal(summary.rejected.length, 0);
    assert.equal(records.length, 2);
  });
});

// ─── Task 040 — evidence completeness (S-026) ──────────────────────────────

void describe("S-026 — a resolved row's evidence answers the post-mortem questions", () => {
  void it("happy path: which sources, what they said, when, and which criteria passed", async () => {
    const { submitter } = fakeSubmitter();
    const { log, records } = fakeLog();
    const secondary: ProviderSlate = {
      provider: "secondprovider",
      league: "nfl",
      events: [event({ providerEventId: "sec-1" })],
      delayed: false,
      fetchedAt: NOW * 1000 - 5_000,
    };
    const plan = planResolution(slate([event()]), secondary, NOW);

    const summary = await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW,
      storedEventOf: () => ({
        status: "final",
        homeScore: 27,
        awayScore: 20,
        lastPolledAt: new Date(NOW * 1000 - 30_000),
      }),
    });
    assert.equal(summary.resolved, 2);

    const evidence = records[0].evidence as {
      schema: string;
      providerEventId: string;
      gameWinningOutcomeIndex: number;
      policy: string;
      sources: { role: string; provider: string; retrievedAt: string | null; status: string; homeScore: number | null; awayScore: number | null }[];
      consensus: { kind: string };
      confidenceState: string | null;
      criteria: { name: string; pass: boolean }[];
      decidedAt: string;
    };

    assert.equal(evidence.schema, "resolution-evidence@1");
    // WHICH sources: primary, secondary, and the ingest store.
    assert.deepEqual(
      evidence.sources.map((s) => s.role),
      ["primary", "secondary", "store"],
    );
    // WHAT each said: every source carries its own scoreline and status.
    assert.ok(evidence.sources.every((s) => s.status === "final"));
    assert.ok(evidence.sources.every((s) => s.homeScore === 27 && s.awayScore === 20));
    // WHEN: every source carries its own retrieval timestamp.
    assert.ok(evidence.sources.every((s) => s.retrievedAt !== null));
    assert.equal(evidence.sources[0].retrievedAt, new Date(NOW * 1000).toISOString());
    assert.equal(evidence.sources[1].retrievedAt, new Date(NOW * 1000 - 5_000).toISOString());
    // The consensus verdict and the derived winner.
    assert.equal(evidence.consensus.kind, "agreed");
    assert.equal(evidence.gameWinningOutcomeIndex, 0);
    assert.equal(evidence.policy, "dual-source");
    // WHICH criteria passed: the full list, all green.
    assert.equal(evidence.criteria.length, 9);
    assert.ok(evidence.criteria.every((c) => c.pass));
    // The confidence state that authorised the write.
    assert.equal(records[0].confidenceState, "VERIFIED");
    // And both markets carry evidence, each naming its own side.
    assert.ok(records.every((r) => r.evidence !== undefined));
  });

  void it("single-source policy is recorded as an explicit exemption, never as agreement", async () => {
    const { submitter } = fakeSubmitter();
    const { log, records } = fakeLog();
    const plan = planResolution(slate([event()]), null, NOW);

    await executeResolution(plan, submitter, log, "espn", { nowSeconds: NOW });

    const evidence = records[0].evidence as {
      policy: string;
      consensus: { kind: string };
      criteria: { name: string; detail: string }[];
    };
    assert.equal(evidence.policy, "single-source");
    assert.equal(evidence.consensus.kind, "policy-exempt-single-source");
    const corroborated = evidence.criteria.find((c) => c.name === "corroborated");
    assert.match(corroborated?.detail ?? "", /policy-exempt/);
  });
});

// ─── Task 040 — assessments feed the confidence machine (S-024) ────────────

void describe("planResolution assessments", () => {
  void it("every final on a fresh slate is assessed, held or not", () => {
    const plan = planResolution(
      slate([
        event(),
        event({
          providerEventId: "no-scores",
          homeScore: undefined as never,
          awayScore: undefined as never,
        }),
        event({ providerEventId: "live", status: "in_progress", startsAt: NOW - 600 }),
      ]),
      null,
      NOW,
    );
    assert.deepEqual(
      plan.assessments.map((a) => a.providerEventId).sort(),
      ["401671789", "no-scores"],
    );
    assert.ok(plan.assessments.every((a) => a.policy === "single-source"));
  });

  void it("a delayed slate assesses nothing — stale data must not move confidence", () => {
    const plan = planResolution(slate([event()], true), null, NOW);
    assert.equal(plan.assessments.length, 0);
  });

  void it("a disagreement is assessed even though the event is held", () => {
    const secondary = slate([event({ providerEventId: "other-id", homeScore: 20, awayScore: 27 })]);
    const plan = planResolution(slate([event()]), secondary, NOW);
    assert.equal(plan.submissions.length, 0);
    assert.equal(plan.assessments.length, 1);
    assert.equal(plan.assessments[0].corroboration?.kind, "disagreed");
    assert.equal(plan.assessments[0].policy, "dual-source");
  });
});
