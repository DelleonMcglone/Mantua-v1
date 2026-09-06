import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ProviderEvent } from "./provider.ts";
import {
  MAX_RESOLUTION_FEED_AGE_MS,
  STORE_POLL_MAX_AGE_MS,
  checkFeedFreshness,
  feedLagMs,
  reconcileWithStoredEvent,
} from "./resolution-freshness.ts";
import {
  MIN_GAME_DURATION_SECONDS,
  type CriteriaInput,
  assertResolutionCriteria,
} from "./resolution-criteria.ts";

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

/** A fully-passing input: home won, resolving the home market's YES. */
function input(overrides: Partial<CriteriaInput> = {}): CriteriaInput {
  return {
    marketId: "0xmarket",
    marketOutcomeIndex: 0,
    outcome: 0,
    event: event(),
    secondaryEvent: null,
    corroboration: null,
    policy: "single-source",
    confidenceState: "VERIFIED",
    slate: { provider: "espn", fetchedAt: NOW * 1000, delayed: false },
    secondarySlate: null,
    storedEvent: null,
    freezeCompleted: true,
    nowSeconds: NOW,
    ...overrides,
  };
}

function failedNames(i: CriteriaInput): string[] {
  const verdict = assertResolutionCriteria(i);
  return verdict.ok ? [] : verdict.failed.map((c) => c.name);
}

void describe("S-025 — assertResolutionCriteria", () => {
  void it("the happy path mints an authorization carrying outcome, criteria, and evidence", () => {
    const verdict = assertResolutionCriteria(input());
    assert.ok(verdict.ok);
    assert.equal(verdict.auth.marketId, "0xmarket");
    assert.equal(verdict.auth.outcome, 0);
    assert.equal(verdict.auth.criteria.length, 9);
    assert.ok(verdict.auth.criteria.every((c) => c.pass));
    assert.equal(verdict.auth.evidence.schema, "resolution-evidence@1");
  });

  // Each criterion rejected INDEPENDENTLY — one bad fact, one named failure.

  void it("rejects a non-final status, whatever else looks plausible", () => {
    // Scores and timing are all fine here — status alone must sink it.
    const failed = failedNames(input({ event: event({ status: "in_progress" }) }));
    assert.deepEqual(failed, ["final_status"]);
    assert.ok(failedNames(input({ event: event({ status: "unknown" }) })).includes("final_status"));
  });

  void it("rejects a delayed slate (feed_fresh)", () => {
    const failed = failedNames(
      input({ slate: { provider: "espn", fetchedAt: NOW * 1000, delayed: true } }),
    );
    assert.deepEqual(failed, ["feed_fresh"]);
  });

  void it("rejects a slate older than the freshness bound (feed_fresh)", () => {
    const failed = failedNames(
      input({
        slate: {
          provider: "espn",
          fetchedAt: NOW * 1000 - MAX_RESOLUTION_FEED_AGE_MS - 1,
          delayed: false,
        },
      }),
    );
    assert.deepEqual(failed, ["feed_fresh"]);
  });

  void it("rejects a final before kickoff plus a minimum game duration (kickoff_elapsed)", () => {
    const failed = failedNames(
      input({ event: event({ startsAt: NOW - MIN_GAME_DURATION_SECONDS + 60 }) }),
    );
    assert.deepEqual(failed, ["kickoff_elapsed"]);
    // Before kickoff entirely is also refused.
    assert.deepEqual(failedNames(input({ event: event({ startsAt: NOW + 600 }) })), [
      "kickoff_elapsed",
    ]);
  });

  void it("rejects missing, negative, non-integer, and tied scores (scores_consistent)", () => {
    for (const bad of [
      { homeScore: undefined as never, awayScore: undefined as never },
      { homeScore: -3 },
      { homeScore: 20.5 },
      { homeScore: 20, awayScore: 20 },
    ]) {
      const failed = failedNames(input({ event: event(bad) }));
      assert.ok(failed.includes("scores_consistent"), JSON.stringify(bad));
    }
  });

  void it("rejects an outcome the scores do not imply, on BOTH markets (outcome_mapping)", () => {
    // Home won 27-20. Home market (side 0) must resolve YES (0)…
    assert.deepEqual(failedNames(input({ outcome: 1 })), ["outcome_mapping"]);
    // …and the away market (side 1) must resolve NO (1).
    assert.deepEqual(failedNames(input({ marketOutcomeIndex: 1, outcome: 0 })), [
      "outcome_mapping",
    ]);
    assert.deepEqual(failedNames(input({ marketOutcomeIndex: 1, outcome: 1 })), []);
  });

  void it("dual-source policy requires an agreed corroboration on the derived winner", () => {
    // No verdict supplied at all.
    assert.deepEqual(failedNames(input({ policy: "dual-source" })), ["corroborated"]);
    // Sources disagreed.
    assert.deepEqual(
      failedNames(
        input({
          policy: "dual-source",
          corroboration: { kind: "disagreed", reason: "winner mismatch", primary: "a", secondary: "b" },
        }),
      ),
      ["corroborated"],
    );
    // Secondary had no coverage.
    assert.deepEqual(
      failedNames(
        input({ policy: "dual-source", corroboration: { kind: "single-source", reason: "gap" } }),
      ),
      ["corroborated"],
    );
    // Agreement on a DIFFERENT winner than the scores imply is still refused.
    assert.deepEqual(
      failedNames(
        input({ policy: "dual-source", corroboration: { kind: "agreed", winningOutcomeIndex: 1 } }),
      ),
      ["corroborated"],
    );
    // Agreement on the derived winner passes.
    assert.deepEqual(
      failedNames(
        input({ policy: "dual-source", corroboration: { kind: "agreed", winningOutcomeIndex: 0 } }),
      ),
      [],
    );
  });

  void it("rejects every confidence state except VERIFIED and RESOLVED (confidence_verified)", () => {
    for (const state of ["PENDING_RECONCILIATION", "DISPUTED", "MANUAL_REVIEW", null] as const) {
      assert.deepEqual(failedNames(input({ confidenceState: state })), ["confidence_verified"]);
    }
    assert.deepEqual(failedNames(input({ confidenceState: "RESOLVED" })), []);
  });

  void it("rejects when the ingest store contradicts the snapshot (store_reconciled)", () => {
    const failed = failedNames(
      input({
        storedEvent: {
          status: "final",
          homeScore: 20,
          awayScore: 27,
          lastPolledAt: new Date(NOW * 1000 - 60_000),
        },
      }),
    );
    assert.deepEqual(failed, ["store_reconciled"]);
  });

  void it("rejects when ingestion has gone dark (store_reconciled)", () => {
    const failed = failedNames(
      input({
        storedEvent: {
          status: "final",
          homeScore: 27,
          awayScore: 20,
          lastPolledAt: new Date(NOW * 1000 - STORE_POLL_MAX_AGE_MS - 1),
        },
      }),
    );
    assert.deepEqual(failed, ["store_reconciled"]);
  });

  void it("rejects a resolve whose freeze sweep did not complete (market_frozen)", () => {
    assert.deepEqual(failedNames(input({ freezeCompleted: false })), ["market_frozen"]);
  });

  void it("a rejection names EVERY failed criterion, not just the first", () => {
    const verdict = assertResolutionCriteria(
      input({
        event: event({ status: "in_progress", homeScore: undefined as never, awayScore: undefined as never }),
        confidenceState: null,
        freezeCompleted: false,
      }),
    );
    assert.ok(!verdict.ok);
    const names = verdict.failed.map((c) => c.name);
    for (const expected of [
      "final_status",
      "scores_consistent",
      "outcome_mapping",
      "confidence_verified",
      "market_frozen",
    ]) {
      assert.ok(names.includes(expected as never), `${expected} should be reported`);
    }
  });
});

void describe("S-026 — the evidence bundle", () => {
  void it("records every source with role, retrieval time, and scoreline", () => {
    const verdict = assertResolutionCriteria(
      input({
        policy: "dual-source",
        corroboration: { kind: "agreed", winningOutcomeIndex: 0 },
        secondaryEvent: event({ providerEventId: "sec-1", homeScore: 28 }),
        secondarySlate: { provider: "secondprovider", fetchedAt: NOW * 1000 - 3_000, delayed: false },
        storedEvent: {
          status: "final",
          homeScore: 27,
          awayScore: 20,
          lastPolledAt: new Date(NOW * 1000 - 45_000),
        },
      }),
    );
    assert.ok(verdict.ok);
    const e = verdict.auth.evidence;
    assert.deepEqual(
      e.sources.map((s) => [s.role, s.provider]),
      [
        ["primary", "espn"],
        ["secondary", "secondprovider"],
        ["store", "mantua-ingest"],
      ],
    );
    // Per-source retrieval timestamps survive verbatim.
    assert.equal(e.sources[1].retrievedAt, new Date(NOW * 1000 - 3_000).toISOString());
    assert.equal(e.sources[2].retrievedAt, new Date(NOW * 1000 - 45_000).toISOString());
    // The secondary's corrected-but-agreeing scoreline is preserved as it said it.
    assert.equal(e.sources[1].homeScore, 28);
    assert.equal(e.consensus.kind, "agreed");
    assert.equal(e.gameWinningOutcomeIndex, 0);
    assert.equal(e.confidenceState, "VERIFIED");
    assert.equal(e.criteria.length, 9);
    assert.equal(e.decidedAt, new Date(NOW * 1000).toISOString());
  });
});

void describe("S-022 — feed freshness and store reconciliation", () => {
  void it("measures lag against the fetch timestamp, floored at zero", () => {
    assert.equal(feedLagMs(1_000, 4_000), 3_000);
    assert.equal(feedLagMs(4_000, 1_000), 0);
  });

  void it("the breaker trips on delayed data and on old data, and only then", () => {
    const now = NOW * 1000;
    assert.equal(checkFeedFreshness({ delayed: false, fetchedAt: now - 30_000 }, now).fresh, true);
    const delayed = checkFeedFreshness({ delayed: true, fetchedAt: now }, now);
    assert.equal(delayed.fresh, false);
    assert.match(delayed.reason ?? "", /delayed/);
    const old = checkFeedFreshness(
      { delayed: false, fetchedAt: now - MAX_RESOLUTION_FEED_AGE_MS - 1 },
      now,
    );
    assert.equal(old.fresh, false);
    assert.match(old.reason ?? "", /exceeds/);
  });

  void it("reconciliation passes on a consistent store and on no store at all", () => {
    const now = NOW * 1000;
    assert.equal(reconcileWithStoredEvent(event(), null, now).ok, true);
    assert.equal(
      reconcileWithStoredEvent(
        event(),
        { status: "final", homeScore: 27, awayScore: 20, lastPolledAt: new Date(now - 10_000) },
        now,
      ).ok,
      true,
    );
    // A store that is merely behind (still in_progress) is not a contradiction.
    assert.equal(
      reconcileWithStoredEvent(
        event(),
        { status: "in_progress", homeScore: 14, awayScore: 10, lastPolledAt: new Date(now - 10_000) },
        now,
      ).ok,
      true,
    );
  });

  void it("reconciliation fails on a contradicting winner and on a never-polled row", () => {
    const now = NOW * 1000;
    const contradiction = reconcileWithStoredEvent(
      event(),
      { status: "final", homeScore: 3, awayScore: 30, lastPolledAt: new Date(now - 10_000) },
      now,
    );
    assert.equal(contradiction.ok, false);
    assert.match(contradiction.detail, /disagrees/);
    const dark = reconcileWithStoredEvent(
      event(),
      { status: "final", homeScore: 27, awayScore: 20, lastPolledAt: null },
      now,
    );
    assert.equal(dark.ok, false);
    assert.match(dark.detail, /ingestion stale/);
  });
});
