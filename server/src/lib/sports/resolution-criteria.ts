/**
 * S-025 — Mantua's own resolution criteria, checked independently of any
 * provider flag, plus the S-026 evidence bundle that records exactly what
 * was checked and what every source said.
 *
 * The stance: a market must never resolve merely because a provider said
 * "final". `assertResolutionCriteria` re-derives every fact a resolve
 * depends on from raw inputs and refuses unless ALL of them hold:
 *
 *  1. `final_status`        — the event reached a final status;
 *  2. `feed_fresh`          — the S-022 breaker: data neither delayed nor
 *                             older than MAX_RESOLUTION_FEED_AGE_MS;
 *  3. `kickoff_elapsed`     — kickoff passed AND a minimum plausible game
 *                             duration elapsed (a "final" five minutes after
 *                             kickoff is a data error, not a result);
 *  4. `scores_consistent`   — both scores present, non-negative integers,
 *                             not tied (ties are the void path, never a
 *                             resolve), winner derivable;
 *  5. `outcome_mapping`     — the outcome being submitted for THIS market
 *                             is the one the scores imply, re-deriving the
 *                             two-vocabulary mapping independently;
 *  6. `corroborated`        — dual-source policy: providers agreed on this
 *                             winner; single-source policy: the exemption is
 *                             recorded, never silently assumed;
 *  7. `confidence_verified` — the S-024 state machine says VERIFIED (or
 *                             RESOLVED, for a pair's second market);
 *  8. `store_reconciled`    — the ingest pipeline's own record neither
 *                             contradicts the snapshot nor has gone dark;
 *  9. `market_frozen`       — the executor swept the freeze before asking.
 *
 * Passing yields a `ResolutionAuthorization` — the ONLY object the
 * submitter's `resolve` accepts. Its constructor is module-private, so the
 * one path to an on-chain resolve is through this gate; bypassing it is a
 * deliberate act of surgery, not an accident.
 */

import type { Corroboration, CorroborationPolicy } from "./consensus.ts";
import type { ProviderEvent } from "./provider.ts";
import {
  type ConfidenceState,
  confidencePermitsResolution,
} from "./resolution-confidence.ts";
import {
  type StoredEventSnapshot,
  checkFeedFreshness,
  reconcileWithStoredEvent,
} from "./resolution-freshness.ts";

/** Shortest a real NFL/WNBA game can plausibly take from kickoff to final.
 *  Deliberately conservative — its job is to catch a provider reporting
 *  "final" on a game that cannot have been played, not to model overtime. */
export const MIN_GAME_DURATION_SECONDS = 3600;

export type CriterionName =
  | "final_status"
  | "feed_fresh"
  | "kickoff_elapsed"
  | "scores_consistent"
  | "outcome_mapping"
  | "corroborated"
  | "confidence_verified"
  | "store_reconciled"
  | "market_frozen";

export interface CriteriaResult {
  name: CriterionName;
  pass: boolean;
  detail: string;
}

/** Metadata about the slate a snapshot rode in on. */
export interface SlateMeta {
  provider: string;
  fetchedAt: number;
  delayed: boolean;
}

export interface CriteriaInput {
  marketId: `0x${string}`;
  /** Which side of the game this market's YES names: 0 home, 1 away. */
  marketOutcomeIndex: number;
  /** The outcome about to be submitted: 0 = this market's YES won, 1 = NO. */
  outcome: number;
  event: ProviderEvent;
  secondaryEvent: ProviderEvent | null;
  corroboration: Corroboration | null;
  policy: CorroborationPolicy;
  confidenceState: ConfidenceState | null;
  slate: SlateMeta;
  secondarySlate: SlateMeta | null;
  storedEvent: StoredEventSnapshot | null;
  /** True only after the executor's freeze sweep ran for this market. */
  freezeCompleted: boolean;
  nowSeconds: number;
}

// ─── Evidence (S-026) ──────────────────────────────────────────────────────

export interface EvidenceSource {
  role: "primary" | "secondary" | "store";
  provider: string;
  /** When this source's data was retrieved, ISO-8601. */
  retrievedAt: string | null;
  delayed: boolean | null;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  startsAt: number | null;
  home: string | null;
  away: string | null;
}

/**
 * The complete why-this-outcome-won record persisted with every resolution
 * (resolutions.source_payload). A post-mortem must be able to answer from
 * this row alone: which sources, what did each say, when was each retrieved,
 * what did consensus conclude, which criteria passed, and what confidence
 * state authorised the write.
 */
export interface ResolutionEvidence {
  schema: "resolution-evidence@1";
  providerEventId: string;
  marketId: string;
  marketOutcomeIndex: number;
  outcome: number;
  gameWinningOutcomeIndex: number | null;
  policy: CorroborationPolicy;
  sources: EvidenceSource[];
  consensus:
    | Corroboration
    | { kind: "policy-exempt-single-source"; reason: string };
  confidenceState: ConfidenceState | null;
  criteria: CriteriaResult[];
  decidedAt: string;
}

/**
 * D-104 — the evidence bundle a MANUAL override writes instead of the
 * automated `ResolutionEvidence`. Deliberately honest about what it is not:
 * no criteria were checked, no sources corroborated — the record is the
 * operator's identity trail (mandatory note, decidedAt) and the outcome.
 */
export interface ManualOverrideEvidence {
  schema: "resolution-evidence@1";
  kind: "manual-override";
  providerEventId: string | null;
  marketId: string;
  /** 0 = this market's YES won, 1 = NO; null for a manual void. */
  outcome: number | null;
  /** The operator's mandatory justification (also on `resolutions.note`). */
  note: string;
  decidedAt: string;
}

function sourceFrom(
  role: EvidenceSource["role"],
  provider: string,
  event: ProviderEvent | null,
  meta: { fetchedAt: number | null; delayed: boolean | null },
): EvidenceSource {
  return {
    role,
    provider,
    retrievedAt: meta.fetchedAt === null ? null : new Date(meta.fetchedAt).toISOString(),
    delayed: meta.delayed,
    status: event?.status ?? "unknown",
    homeScore: event?.homeScore ?? null,
    awayScore: event?.awayScore ?? null,
    startsAt: event?.startsAt ?? null,
    home: event?.home.key ?? null,
    away: event?.away.key ?? null,
  };
}

export function buildEvidence(
  input: CriteriaInput,
  criteria: CriteriaResult[],
  gameWinningOutcomeIndex: number | null,
): ResolutionEvidence {
  const sources: EvidenceSource[] = [
    sourceFrom("primary", input.slate.provider, input.event, {
      fetchedAt: input.slate.fetchedAt,
      delayed: input.slate.delayed,
    }),
  ];
  if (input.secondarySlate) {
    sources.push(
      sourceFrom("secondary", input.secondarySlate.provider, input.secondaryEvent, {
        fetchedAt: input.secondarySlate.fetchedAt,
        delayed: input.secondarySlate.delayed,
      }),
    );
  }
  if (input.storedEvent) {
    sources.push({
      role: "store",
      provider: "mantua-ingest",
      retrievedAt: input.storedEvent.lastPolledAt?.toISOString() ?? null,
      delayed: null,
      status: input.storedEvent.status,
      homeScore: input.storedEvent.homeScore,
      awayScore: input.storedEvent.awayScore,
      startsAt: null,
      home: null,
      away: null,
    });
  }

  return {
    schema: "resolution-evidence@1",
    providerEventId: input.event.providerEventId,
    marketId: input.marketId,
    marketOutcomeIndex: input.marketOutcomeIndex,
    outcome: input.outcome,
    gameWinningOutcomeIndex,
    policy: input.policy,
    sources,
    consensus:
      input.corroboration ??
      ({
        kind: "policy-exempt-single-source",
        reason: "no secondary provider configured (DM-107 vendor unchosen)",
      } as const),
    confidenceState: input.confidenceState,
    criteria,
    decidedAt: new Date(input.nowSeconds * 1000).toISOString(),
  };
}

// ─── The gate ──────────────────────────────────────────────────────────────

/** Mint function wired up by the class's static block — the only way to
 *  construct an authorization is `assertResolutionCriteria` passing. */
let mintAuthorization:
  | (<E extends ResolutionEvidence | ManualOverrideEvidence>(
      marketId: `0x${string}`,
      outcome: number,
      criteria: CriteriaResult[],
      evidence: E,
    ) => ResolutionAuthorization<E>)
  | null = null;

/**
 * Proof that one specific (market, outcome) passed the full criteria gate —
 * or, exactly once per D-104, that an operator explicitly overrode it.
 * `ResolutionSubmitter.resolve` takes this instead of loose arguments, so
 * the type system routes every on-chain resolve through one of exactly two
 * mints in this module: `assertResolutionCriteria` (automated, evidence is
 * the full `ResolutionEvidence` bundle) and `authorizeManualOverride` (the
 * audited D-104 operator path, mandatory note). Generic over the evidence
 * type so each mint's callers see the exact bundle shape they were given.
 */
export class ResolutionAuthorization<
  E extends ResolutionEvidence | ManualOverrideEvidence = ResolutionEvidence | ManualOverrideEvidence,
> {
  readonly marketId: `0x${string}`;
  readonly outcome: number;
  readonly criteria: readonly CriteriaResult[];
  readonly evidence: E;

  private constructor(
    marketId: `0x${string}`,
    outcome: number,
    criteria: CriteriaResult[],
    evidence: E,
  ) {
    this.marketId = marketId;
    this.outcome = outcome;
    this.criteria = criteria;
    this.evidence = evidence;
  }

  static {
    mintAuthorization = (marketId, outcome, criteria, evidence) =>
      new ResolutionAuthorization(marketId, outcome, criteria, evidence);
  }
}

/**
 * D-104 — the audited manual-override mint: the ONLY way to construct a
 * `ResolutionAuthorization` outside the criteria gate. Refuses without a
 * substantive note; the resulting evidence bundle says plainly that nothing
 * was checked. Reached exclusively from the authenticated ops route
 * (`POST /api/ops/resolution/override`) — using it anywhere in the
 * automated pipeline is a review-blocking bug, not a shortcut.
 */
export function authorizeManualOverride(input: {
  marketId: `0x${string}`;
  outcome: number;
  providerEventId: string | null;
  note: string;
  nowSeconds?: number;
}): ResolutionAuthorization<ManualOverrideEvidence> {
  const note = input.note.trim();
  if (note.length === 0) {
    throw new Error("manual override requires a non-empty note (D-104)");
  }
  const evidence: ManualOverrideEvidence = {
    schema: "resolution-evidence@1",
    kind: "manual-override",
    providerEventId: input.providerEventId,
    marketId: input.marketId,
    outcome: input.outcome,
    note,
    decidedAt: new Date((input.nowSeconds ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };
  if (!mintAuthorization) throw new Error("authorization mint not initialised");
  return mintAuthorization(input.marketId, input.outcome, [], evidence);
}

export type CriteriaVerdict =
  | { ok: true; auth: ResolutionAuthorization<ResolutionEvidence>; criteria: CriteriaResult[] }
  | { ok: false; failed: CriteriaResult[]; criteria: CriteriaResult[] };

/**
 * Check every resolution criterion and either mint an authorization or say
 * exactly which criteria failed. Never throws on bad data — refusal IS the
 * answer — and always evaluates the full list, so a rejection names every
 * problem at once instead of the first.
 */
export function assertResolutionCriteria(input: CriteriaInput): CriteriaVerdict {
  const criteria: CriteriaResult[] = [];
  const add = (name: CriterionName, pass: boolean, detail: string) => {
    criteria.push({ name, pass, detail });
  };

  const e = input.event;

  add(
    "final_status",
    e.status === "final",
    e.status === "final" ? "event status is final" : `event status is ${e.status}, not final`,
  );

  const nowMs = input.nowSeconds * 1000;
  const freshness = checkFeedFreshness(input.slate, nowMs);
  add(
    "feed_fresh",
    freshness.fresh,
    freshness.fresh
      ? `primary feed lag ${String(freshness.lagMs)}ms within bound`
      : (freshness.reason ?? "feed not fresh"),
  );

  const earliestFinal = e.startsAt + MIN_GAME_DURATION_SECONDS;
  add(
    "kickoff_elapsed",
    e.startsAt > 0 && input.nowSeconds >= earliestFinal,
    e.startsAt <= 0
      ? "event has no plausible kickoff timestamp"
      : input.nowSeconds < e.startsAt
        ? "kickoff has not happened yet"
        : input.nowSeconds < earliestFinal
          ? `only ${String(input.nowSeconds - e.startsAt)}s since kickoff; a real game takes ≥ ${String(MIN_GAME_DURATION_SECONDS)}s`
          : "kickoff plus minimum game duration elapsed",
  );

  const scoresPresent = e.homeScore !== undefined && e.awayScore !== undefined;
  const scoresSane =
    scoresPresent &&
    Number.isInteger(e.homeScore) &&
    Number.isInteger(e.awayScore) &&
    (e.homeScore as number) >= 0 &&
    (e.awayScore as number) >= 0;
  const decisive = scoresSane && e.homeScore !== e.awayScore;
  add(
    "scores_consistent",
    decisive,
    !scoresPresent
      ? "final reported without both scores"
      : !scoresSane
        ? `scores are not non-negative integers (${String(e.homeScore)}-${String(e.awayScore)})`
        : !decisive
          ? "scores are tied — ties void, they never resolve"
          : `decisive scoreline ${String(e.homeScore)}-${String(e.awayScore)}`,
  );

  // Re-derive the two-vocabulary mapping (game winner → this market's
  // YES/NO) independently of the planner that proposed the submission.
  const gameWinner = decisive ? ((e.homeScore as number) > (e.awayScore as number) ? 0 : 1) : null;
  const expectedOutcome =
    gameWinner === null ? null : gameWinner === input.marketOutcomeIndex ? 0 : 1;
  add(
    "outcome_mapping",
    expectedOutcome !== null && input.outcome === expectedOutcome,
    expectedOutcome === null
      ? "no derivable winner to map"
      : input.outcome === expectedOutcome
        ? `scores imply outcome ${String(expectedOutcome)} for market side ${String(input.marketOutcomeIndex)}`
        : `submitted outcome ${String(input.outcome)} contradicts derived outcome ${String(expectedOutcome)}`,
  );

  if (input.policy === "single-source") {
    add(
      "corroborated",
      true,
      "policy-exempt: single-source regime (no secondary provider configured)",
    );
  } else {
    const agreed =
      input.corroboration?.kind === "agreed" &&
      gameWinner !== null &&
      input.corroboration.winningOutcomeIndex === gameWinner;
    add(
      "corroborated",
      agreed,
      input.corroboration === null
        ? "dual-source policy but no corroboration verdict supplied"
        : input.corroboration.kind !== "agreed"
          ? `corroboration ${input.corroboration.kind}: ${"reason" in input.corroboration ? input.corroboration.reason : "winner mismatch"}`
          : agreed
            ? "both providers agree on this winner"
            : "corroborated winner does not match derived winner",
    );
  }

  add(
    "confidence_verified",
    confidencePermitsResolution(input.confidenceState),
    `confidence state is ${input.confidenceState ?? "NONE"}`,
  );

  const reconciliation = reconcileWithStoredEvent(e, input.storedEvent, nowMs);
  add("store_reconciled", reconciliation.ok, reconciliation.detail);

  add(
    "market_frozen",
    input.freezeCompleted,
    input.freezeCompleted
      ? "freeze sweep completed before resolve"
      : "resolve requested without a completed freeze sweep",
  );

  const failed = criteria.filter((c) => !c.pass);
  if (failed.length > 0) return { ok: false, failed, criteria };

  const evidence = buildEvidence(input, criteria, gameWinner);
  if (!mintAuthorization) throw new Error("authorization mint not initialised");
  return { ok: true, auth: mintAuthorization(input.marketId, input.outcome, criteria, evidence), criteria };
}
