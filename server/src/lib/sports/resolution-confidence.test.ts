import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIDENCE_STATES,
  LEGAL_TRANSITIONS,
  type ConfidenceObservation,
  type ConfidenceState,
  confidencePermitsResolution,
  inlineConfidence,
  isLegalTransition,
  nextConfidenceState,
  observationFor,
} from "./resolution-confidence.ts";

const OBSERVATIONS: ConfidenceObservation[] = [
  { kind: "corroborated_final", winningOutcomeIndex: 0 },
  { kind: "policy_exempt_final", winningOutcomeIndex: 0 },
  { kind: "single_source_final", reason: "secondary has no coverage" },
  { kind: "sources_disagree", reason: "winner mismatch" },
  { kind: "resolved_onchain", txHash: "0xabc" },
  { kind: "reconciliation_timeout" },
];

void describe("S-024 — the transition table", () => {
  void it("every transition the machine performs is in the legal table", () => {
    // Exhaustive sweep: from every state (and NONE), apply every observation
    // and check the result against LEGAL_TRANSITIONS. The table is the spec;
    // this test pins the implementation to it.
    const froms: (ConfidenceState | null)[] = [null, ...CONFIDENCE_STATES];
    for (const from of froms) {
      for (const obs of OBSERVATIONS) {
        const step = nextConfidenceState(from, obs);
        if (step.changed) {
          assert.ok(
            step.state !== null && isLegalTransition(from, step.state),
            `${from ?? "NONE"} --${obs.kind}--> ${String(step.state)} must be legal`,
          );
        } else {
          assert.equal(step.state, from, "an unchanged step keeps the current state");
        }
      }
    }
  });

  void it("the table itself is one-way with escalation: no path relaxes confidence", () => {
    // DISPUTED must never legally reach VERIFIED or RESOLVED, directly or
    // transitively; MANUAL_REVIEW and RESOLVED are absorbing.
    const reachableFrom = (start: ConfidenceState): Set<ConfidenceState> => {
      const seen = new Set<ConfidenceState>();
      const queue: ConfidenceState[] = [start];
      while (queue.length > 0) {
        const s = queue.pop() as ConfidenceState;
        for (const next of LEGAL_TRANSITIONS[s]) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      return seen;
    };
    const fromDisputed = reachableFrom("DISPUTED");
    assert.ok(!fromDisputed.has("VERIFIED"), "DISPUTED can never reach VERIFIED");
    assert.ok(!fromDisputed.has("RESOLVED"), "DISPUTED can never reach RESOLVED");
    assert.ok(!fromDisputed.has("PENDING_RECONCILIATION"));
    assert.equal(LEGAL_TRANSITIONS.MANUAL_REVIEW.length, 0, "MANUAL_REVIEW is absorbing");
    assert.equal(LEGAL_TRANSITIONS.RESOLVED.length, 0, "RESOLVED is absorbing");
  });
});

void describe("S-024 — the legal paths", () => {
  void it("corroborated final: NONE → VERIFIED → RESOLVED", () => {
    const a = nextConfidenceState(null, { kind: "corroborated_final", winningOutcomeIndex: 0 });
    assert.deepEqual([a.state, a.changed], ["VERIFIED", true]);
    const b = nextConfidenceState(a.state, { kind: "resolved_onchain", txHash: "0x1" });
    assert.deepEqual([b.state, b.changed], ["RESOLVED", true]);
  });

  void it("single-source final: NONE → PENDING_RECONCILIATION, then VERIFIED on corroboration", () => {
    const a = nextConfidenceState(null, { kind: "single_source_final", reason: "no coverage yet" });
    assert.equal(a.state, "PENDING_RECONCILIATION");
    const b = nextConfidenceState(a.state, { kind: "corroborated_final", winningOutcomeIndex: 1 });
    assert.deepEqual([b.state, b.changed], ["VERIFIED", true]);
  });

  void it("pending reconciliation escalates on timeout, and ONLY from pending", () => {
    const pending = nextConfidenceState("PENDING_RECONCILIATION", {
      kind: "reconciliation_timeout",
    });
    assert.deepEqual([pending.state, pending.changed], ["MANUAL_REVIEW", true]);
    const verified = nextConfidenceState("VERIFIED", { kind: "reconciliation_timeout" });
    assert.deepEqual([verified.state, verified.changed], ["VERIFIED", false]);
  });

  void it("disagreement disputes from NONE, PENDING, and even VERIFIED", () => {
    for (const from of [null, "PENDING_RECONCILIATION", "VERIFIED"] as const) {
      const step = nextConfidenceState(from, { kind: "sources_disagree", reason: "mismatch" });
      assert.deepEqual([step.state, step.changed], ["DISPUTED", true], `from ${String(from)}`);
    }
  });

  void it("DISPUTED never auto-resolves: every further observation escalates to MANUAL_REVIEW", () => {
    for (const obs of OBSERVATIONS) {
      const step = nextConfidenceState("DISPUTED", obs);
      assert.equal(step.state, "MANUAL_REVIEW", `DISPUTED + ${obs.kind} must escalate, not settle`);
    }
  });

  void it("MANUAL_REVIEW and RESOLVED absorb every automated observation", () => {
    for (const from of ["MANUAL_REVIEW", "RESOLVED"] as const) {
      for (const obs of OBSERVATIONS) {
        const step = nextConfidenceState(from, obs);
        assert.deepEqual([step.state, step.changed], [from, false], `${from} + ${obs.kind}`);
      }
    }
  });
});

void describe("S-024 — the illegal moves", () => {
  void it("resolved_onchain from anything but VERIFIED is refused", () => {
    for (const from of [null, "PENDING_RECONCILIATION"] as const) {
      const step = nextConfidenceState(from, { kind: "resolved_onchain", txHash: "0x1" });
      assert.equal(step.changed, false, `resolved_onchain from ${String(from)} must not transition`);
      assert.equal(step.state, from);
    }
  });

  void it("a corroboration observed after verification changes nothing (idempotent sweeps)", () => {
    const step = nextConfidenceState("VERIFIED", {
      kind: "corroborated_final",
      winningOutcomeIndex: 0,
    });
    assert.deepEqual([step.state, step.changed], ["VERIFIED", false]);
  });

  void it("a secondary dropping coverage does not un-verify a verified outcome", () => {
    const step = nextConfidenceState("VERIFIED", {
      kind: "single_source_final",
      reason: "secondary lost the game",
    });
    assert.deepEqual([step.state, step.changed], ["VERIFIED", false]);
  });
});

void describe("observationFor / inlineConfidence — policy handling", () => {
  void it("single-source policy is a recorded exemption, mapping straight to VERIFIED", () => {
    const obs = observationFor(null, "single-source", 0);
    assert.equal(obs.kind, "policy_exempt_final");
    assert.equal(inlineConfidence(null, "single-source"), "VERIFIED");
  });

  void it("dual-source verdicts map one-to-one onto observations", () => {
    assert.equal(
      observationFor({ kind: "agreed", winningOutcomeIndex: 1 }, "dual-source", 1).kind,
      "corroborated_final",
    );
    assert.equal(
      observationFor({ kind: "single-source", reason: "r" }, "dual-source", 0).kind,
      "single_source_final",
    );
    assert.equal(
      observationFor(
        { kind: "disagreed", reason: "r", primary: "a", secondary: "b" },
        "dual-source",
        0,
      ).kind,
      "sources_disagree",
    );
  });

  void it("inline confidence mirrors the machine: disagreement is DISPUTED, uncorroborated is PENDING", () => {
    assert.equal(
      inlineConfidence({ kind: "disagreed", reason: "r", primary: "a", secondary: "b" }, "dual-source"),
      "DISPUTED",
    );
    assert.equal(
      inlineConfidence({ kind: "single-source", reason: "r" }, "dual-source"),
      "PENDING_RECONCILIATION",
    );
    assert.equal(inlineConfidence({ kind: "agreed", winningOutcomeIndex: 0 }, "dual-source"), "VERIFIED");
  });

  void it("only VERIFIED and RESOLVED permit resolution", () => {
    const permitted = CONFIDENCE_STATES.filter((s) => confidencePermitsResolution(s));
    assert.deepEqual(permitted, ["VERIFIED", "RESOLVED"]);
    assert.equal(confidencePermitsResolution(null), false);
  });
});
