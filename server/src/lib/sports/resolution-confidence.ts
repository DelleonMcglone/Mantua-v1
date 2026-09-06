/**
 * S-024 — the resolution-confidence state machine.
 *
 * Every game outcome the pipeline intends to settle carries an explicit
 * confidence state, persisted in `resolution_reviews`, and the ONLY place
 * transitions are defined is this file. The machine is one-way with
 * escalation: confidence can rise (PENDING_RECONCILIATION → VERIFIED →
 * RESOLVED) or escalate to a human (→ DISPUTED → MANUAL_REVIEW), but it
 * never quietly relaxes. MANUAL_REVIEW and RESOLVED are absorbing for the
 * automated pipeline — a disputed outcome NEVER auto-resolves, and a
 * resolved one never re-enters the queue.
 *
 * Why a state machine rather than the previous per-pass `held` list: a held
 * event evaporated at the end of the sweep. A disagreement between providers
 * (DM-107's whole reason for a second source) was logged and forgotten;
 * nothing recorded that an outcome was ever contested, and a later pass that
 * happened to see agreement would settle as if nothing had happened. The
 * review row is the memory the sweep lacked.
 */

import type { Corroboration, CorroborationPolicy } from "./consensus.ts";

export const CONFIDENCE_STATES = [
  "PENDING_RECONCILIATION",
  "VERIFIED",
  "DISPUTED",
  "MANUAL_REVIEW",
  "RESOLVED",
] as const;

export type ConfidenceState = (typeof CONFIDENCE_STATES)[number];

/**
 * The full legal-transition table — the single source of truth, exported so
 * the tests can enumerate it exhaustively. `NONE` is "no review row yet".
 */
export const LEGAL_TRANSITIONS: Readonly<
  Record<ConfidenceState | "NONE", readonly ConfidenceState[]>
> = {
  NONE: ["PENDING_RECONCILIATION", "VERIFIED", "DISPUTED"],
  PENDING_RECONCILIATION: ["VERIFIED", "DISPUTED", "MANUAL_REVIEW"],
  // A verified outcome can still be contested by a later pass right up until
  // the chain write lands — escalation always stays open.
  VERIFIED: ["RESOLVED", "DISPUTED"],
  // Disputes go one place only: a person. Never back to VERIFIED by code.
  DISPUTED: ["MANUAL_REVIEW"],
  MANUAL_REVIEW: [],
  RESOLVED: [],
};

export function isLegalTransition(from: ConfidenceState | null, to: ConfidenceState): boolean {
  return LEGAL_TRANSITIONS[from ?? "NONE"].includes(to);
}

/** How long a single-source final may wait for corroboration before a human
 *  is asked instead. Bounded (S-024): "pending" must not mean "forever". */
export const RECONCILIATION_TIMEOUT_SECONDS = 2 * 3600;

/** What one settlement pass observed about a game's outcome. */
export type ConfidenceObservation =
  /** Both configured providers agree on a final and its winner. */
  | { kind: "corroborated_final"; winningOutcomeIndex: number }
  /** No secondary provider is configured; DM-107's staged policy accepts the
   *  primary's word plus the criteria gate. Recorded as its own kind so the
   *  evidence trail shows the exemption, not a fake corroboration. */
  | { kind: "policy_exempt_final"; winningOutcomeIndex: number }
  /** A secondary IS configured but could not (yet) confirm this final. */
  | { kind: "single_source_final"; reason: string }
  /** The sources contradict each other on the winner or the teams. */
  | { kind: "sources_disagree"; reason: string }
  /** A resolve transaction landed on-chain. */
  | { kind: "resolved_onchain"; txHash: string }
  /** PENDING_RECONCILIATION outlived RECONCILIATION_TIMEOUT_SECONDS. */
  | { kind: "reconciliation_timeout" };

export interface ConfidenceStep {
  state: ConfidenceState | null;
  changed: boolean;
  reason: string;
}

/** The state an observation asks for, before legality is enforced. */
function targetFor(
  current: ConfidenceState | null,
  obs: ConfidenceObservation,
): ConfidenceState | null {
  // Absorbing states: the auto pipeline may not move them, whatever it sees.
  if (current === "MANUAL_REVIEW" || current === "RESOLVED") return current;
  // A dispute's only exit is escalation — any further automated observation
  // (agreement included) hands it to a human rather than un-disputing it.
  if (current === "DISPUTED") return "MANUAL_REVIEW";

  switch (obs.kind) {
    case "sources_disagree":
      return "DISPUTED";
    case "corroborated_final":
    case "policy_exempt_final":
      return "VERIFIED";
    case "single_source_final":
      // Already-verified stays verified: verification happened on fresh,
      // agreed data; the secondary later dropping coverage is not evidence
      // the outcome was wrong.
      return current === "VERIFIED" ? "VERIFIED" : "PENDING_RECONCILIATION";
    case "reconciliation_timeout":
      return current === "PENDING_RECONCILIATION" ? "MANUAL_REVIEW" : current;
    case "resolved_onchain":
      return current === "VERIFIED" ? "RESOLVED" : current;
  }
}

/**
 * Apply one observation. Returns the new state, whether it changed, and a
 * human-readable reason for the review row's history. An observation whose
 * target would be an illegal transition leaves the state unchanged and says
 * so in the reason — callers log those loudly, because an illegal request is
 * itself a signal something upstream is wrong.
 */
export function nextConfidenceState(
  current: ConfidenceState | null,
  obs: ConfidenceObservation,
): ConfidenceStep {
  const target = targetFor(current, obs);

  if (target === null || target === current) {
    return { state: current, changed: false, reason: `${obs.kind}: no transition` };
  }
  if (!isLegalTransition(current, target)) {
    return {
      state: current,
      changed: false,
      reason: `${obs.kind}: illegal transition ${current ?? "NONE"} → ${target}, refused`,
    };
  }
  const detail =
    "reason" in obs ? obs.reason : "txHash" in obs ? `tx ${obs.txHash}` : obs.kind;
  return { state: target, changed: true, reason: `${obs.kind}: ${detail}` };
}

/**
 * Map one pass's corroboration verdict onto an observation, honouring the
 * configured policy. Kept here (not in the cron) so the cron cannot invent
 * its own vocabulary for what it saw.
 */
export function observationFor(
  corroboration: Corroboration | null,
  policy: CorroborationPolicy,
  winningOutcomeIndex: number,
): ConfidenceObservation {
  if (policy === "single-source" || corroboration === null) {
    return { kind: "policy_exempt_final", winningOutcomeIndex };
  }
  switch (corroboration.kind) {
    case "agreed":
      return { kind: "corroborated_final", winningOutcomeIndex: corroboration.winningOutcomeIndex };
    case "single-source":
      return { kind: "single_source_final", reason: corroboration.reason };
    case "disagreed":
      return { kind: "sources_disagree", reason: corroboration.reason };
  }
}

/**
 * The confidence a resolve would have with no persisted review row — the
 * same rules, derived purely from this pass's verdict. Used by the executor
 * as a floor when the DB-backed state is unavailable, so a disagreement can
 * never resolve even in a context with no review store wired in.
 */
export function inlineConfidence(
  corroboration: Corroboration | null,
  policy: CorroborationPolicy,
): ConfidenceState {
  if (policy === "single-source" || corroboration === null) return "VERIFIED";
  switch (corroboration.kind) {
    case "agreed":
      return "VERIFIED";
    case "single-source":
      return "PENDING_RECONCILIATION";
    case "disagreed":
      return "DISPUTED";
  }
}

/** The states in which the criteria gate may authorise a resolve. RESOLVED
 *  is included so the second market of a pair (per-market failure isolation
 *  can land them on different passes) is not orphaned by the first's success. */
export function confidencePermitsResolution(state: ConfidenceState | null): boolean {
  return state === "VERIFIED" || state === "RESOLVED";
}
