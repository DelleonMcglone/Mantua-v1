/**
 * B4-003 — the resolution service: final detected → outcome derived →
 * submitted on-chain → recorded.
 *
 * Split into a pure planner and an executor over ports, for the same reason
 * the market generator is: the decision about *what to settle* must be
 * testable without a chain, and a bug in data handling must not be able to
 * sign anything by accident.
 *
 * The one genuinely subtle piece is `marketActionsFor`. Each game carries TWO
 * binary markets — one whose YES is "home wins", one whose YES is "away
 * wins" — and `Market.resolve` takes the *winning side of that market's own
 * pair* (0 = YES won, 1 = NO won), not "who won the game". A home win
 * therefore resolves the home market YES and the away market NO. Collapsing
 * those two vocabularies is exactly the kind of mistake that settles a market
 * backwards, so the mapping lives in one function with its own tests.
 */

import { logger } from "../logger.ts";
import { computeMarketId } from "../market-id.ts";
import { type Corroboration, type CorroborationPolicy, corroborate } from "./consensus.ts";
import { type SettlementAction, decideSettlement } from "./ingest.ts";
import type { ProviderEvent, ProviderSlate } from "./provider.ts";
import {
  type ConfidenceState,
  inlineConfidence,
} from "./resolution-confidence.ts";
import {
  type CriteriaResult,
  type ResolutionAuthorization,
  type ResolutionEvidence,
  type SlateMeta,
  assertResolutionCriteria,
} from "./resolution-criteria.ts";
import type { StoredEventSnapshot } from "./resolution-freshness.ts";

/** YES won this market's pair. Mirrors `Market.resolve` semantics. */
export const OUTCOME_YES = 0;
/** NO won this market's pair. */
export const OUTCOME_NO = 1;

/**
 * Everything the S-025 criteria gate needs to independently re-check one
 * settlement decision — the snapshots and verdicts the plan was built from,
 * carried with the submission so the executor never has to trust the plan.
 */
export interface SettlementContext {
  event: ProviderEvent;
  secondaryEvent: ProviderEvent | null;
  corroboration: Corroboration | null;
  policy: CorroborationPolicy;
  slate: SlateMeta;
  secondarySlate: SlateMeta | null;
}

export interface MarketSubmission {
  marketId: `0x${string}`;
  providerEventId: string;
  kind: "resolve" | "void";
  /** Present iff kind is "resolve": 0 = this market's YES won, 1 = its NO won. */
  outcome?: number;
  /** Which game side this market's YES names (0 home, 1 away) — the gate
   *  re-derives the two-vocabulary mapping from it. Present for resolves. */
  marketOutcomeIndex?: number;
  /** The evidence this submission was planned from. */
  context?: SettlementContext;
}

export interface HeldEvent {
  providerEventId: string;
  reason: string;
}

/** One final's verdict this pass — what the S-024 review rows advance on. */
export interface EventAssessment {
  providerEventId: string;
  event: ProviderEvent;
  settlement: SettlementAction;
  corroboration: Corroboration | null;
  policy: CorroborationPolicy;
}

export interface ResolutionPlan {
  /** Markets whose kickoff has passed — freeze is idempotent and permissionless. */
  freezes: MarketSubmission["marketId"][];
  submissions: MarketSubmission[];
  /** Events deliberately not settled this pass, with the reason logged. */
  held: HeldEvent[];
  /** Per-final verdicts for confidence tracking (S-024). Empty on a delayed
   *  slate — stale data must not advance confidence in either direction. */
  assessments: EventAssessment[];
}

/** Both market ids for one game, in outcome-index order (home, away). */
export function marketIdsFor(
  providerEventId: string,
  chainId?: number,
): [`0x${string}`, `0x${string}`] {
  return [
    computeMarketId({
      providerEventId,
      marketType: "moneyline",
      outcomeIndex: 0,
      ...(chainId !== undefined ? { chainId } : {}),
    }),
    computeMarketId({
      providerEventId,
      marketType: "moneyline",
      outcomeIndex: 1,
      ...(chainId !== undefined ? { chainId } : {}),
    }),
  ];
}

/**
 * Translate a game outcome into per-market resolutions.
 *
 * `winningOutcomeIndex` speaks the game's vocabulary (0 = home won the game,
 * 1 = away won). Each market's `resolve` speaks its own (0 = my YES token
 * pays). The home market's YES *is* "home wins", so the two agree there — and
 * are opposites on the away market.
 */
export function marketActionsFor(
  providerEventId: string,
  winningOutcomeIndex: number,
  chainId?: number,
): MarketSubmission[] {
  const [homeMarket, awayMarket] = marketIdsFor(providerEventId, chainId);
  const homeWon = winningOutcomeIndex === 0;
  return [
    {
      marketId: homeMarket,
      providerEventId,
      kind: "resolve",
      outcome: homeWon ? OUTCOME_YES : OUTCOME_NO,
      marketOutcomeIndex: 0,
    },
    {
      marketId: awayMarket,
      providerEventId,
      kind: "resolve",
      outcome: homeWon ? OUTCOME_NO : OUTCOME_YES,
      marketOutcomeIndex: 1,
    },
  ];
}

/** Void both of a game's markets — a called-off game has no winning side. */
export function voidActionsFor(providerEventId: string, chainId?: number): MarketSubmission[] {
  return marketIdsFor(providerEventId, chainId).map((marketId) => ({
    marketId,
    providerEventId,
    kind: "void" as const,
  }));
}

/** Find the secondary provider's row for the same game, by team keys. */
export function matchSecondary(
  primary: ProviderEvent,
  secondary: ProviderSlate | null,
): ProviderEvent | null {
  if (!secondary) return null;
  return (
    secondary.events.find(
      (e) => e.home.key === primary.home.key && e.away.key === primary.away.key,
    ) ?? null
  );
}

/**
 * Plan one settlement pass over a slate.
 *
 * Corroboration policy (DM-107): with no secondary slate supplied, the
 * primary's word plus `decideSettlement`'s guards govern. Once a secondary IS
 * configured, only agreement authorises a resolve — a secondary that is
 * missing the game or not yet final holds the event rather than quietly
 * falling back to single-source, because a configured check that silently
 * skips itself is worse than no check. Voids are exempt: returning collateral
 * cannot pick a wrong winner (B4-005).
 */
export function planResolution(
  primary: ProviderSlate,
  secondary: ProviderSlate | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  chainId?: number,
): ResolutionPlan {
  const plan: ResolutionPlan = { freezes: [], submissions: [], held: [], assessments: [] };
  const policy: CorroborationPolicy = secondary ? "dual-source" : "single-source";
  const slateMeta: SlateMeta = {
    provider: primary.provider,
    fetchedAt: primary.fetchedAt,
    delayed: primary.delayed,
  };
  const secondaryMeta: SlateMeta | null = secondary
    ? { provider: secondary.provider, fetchedAt: secondary.fetchedAt, delayed: secondary.delayed }
    : null;

  for (const event of primary.events) {
    // B4-002: kickoff passed and the game is (or should be) underway — the
    // markets' on-chain freeze can be swept. Idempotent; already-frozen
    // markets simply revert and the submitter treats that as done.
    if (
      event.startsAt <= nowSeconds &&
      (event.status === "scheduled" || event.status === "in_progress")
    ) {
      plan.freezes.push(...marketIdsFor(event.providerEventId, chainId));
    }

    const settlement = decideSettlement(event, primary.delayed);
    const secondaryEvent = secondary ? matchSecondary(event, secondary) : null;
    const check = secondary ? corroborate(event, secondaryEvent) : null;

    // S-024: every final on a FRESH slate gets an assessment, held or not —
    // the review rows are the memory of what each pass observed. A delayed
    // slate assesses nothing: stale data must not advance confidence.
    if (event.status === "final" && !primary.delayed) {
      plan.assessments.push({
        providerEventId: event.providerEventId,
        event,
        settlement,
        corroboration: check,
        policy,
      });
    }

    if (settlement.kind === "wait") {
      if (event.status === "final" || event.status === "unknown") {
        plan.held.push({ providerEventId: event.providerEventId, reason: settlement.reason });
      }
      continue;
    }

    if (settlement.kind === "void") {
      plan.submissions.push(
        ...voidActionsFor(event.providerEventId, chainId).map((s) => ({
          ...s,
          context: {
            event,
            secondaryEvent,
            corroboration: check,
            policy,
            slate: slateMeta,
            secondarySlate: secondaryMeta,
          },
        })),
      );
      continue;
    }

    if (check) {
      if (check.kind !== "agreed") {
        plan.held.push({
          providerEventId: event.providerEventId,
          reason: `corroboration ${check.kind}: ${"reason" in check ? check.reason : "winner mismatch"}`,
        });
        continue;
      }
      if (check.winningOutcomeIndex !== settlement.winningOutcomeIndex) {
        // decideSettlement and corroborate read the same primary event, so a
        // mismatch here means a logic bug, not a data problem. Hold loudly.
        plan.held.push({
          providerEventId: event.providerEventId,
          reason: "internal disagreement between settlement and corroboration",
        });
        continue;
      }
    }

    plan.submissions.push(
      ...marketActionsFor(event.providerEventId, settlement.winningOutcomeIndex, chainId).map(
        (s) => ({
          ...s,
          context: {
            event,
            secondaryEvent,
            corroboration: check,
            policy,
            slate: slateMeta,
            secondarySlate: secondaryMeta,
          },
        }),
      ),
    );
  }

  return plan;
}

// ─── Execution over ports ──────────────────────────────────────────────────

/** On-chain gateway. The only thing in this file that can spend gas.
 *
 *  `resolve` takes a `ResolutionAuthorization` — mintable only by
 *  `assertResolutionCriteria` — not loose (marketId, outcome) arguments.
 *  That makes "resolve without passing the criteria gate" a type error at
 *  every call site, which is the S-025 structural guarantee. */
export interface ResolutionSubmitter {
  signerAddress(): string;
  /** Resolves null when the market was already frozen — that is success. */
  freeze(marketId: `0x${string}`): Promise<string | null>;
  resolve(auth: ResolutionAuthorization): Promise<string>;
  void(marketId: `0x${string}`): Promise<string>;
}

/** B4-006 / S-026 — the public log row for one settlement action. */
export interface ResolutionRecord {
  marketId: `0x${string}`;
  providerEventId: string;
  method: "auto";
  kind: "resolve" | "void";
  outcome: number | null;
  source: string;
  signer: string;
  txHash: string;
  /** The full S-026 evidence bundle. Always present for resolves (the gate
   *  built it); a lighter source snapshot for voids. */
  evidence?: ResolutionEvidence | Record<string, unknown>;
  confidenceState?: ConfidenceState | null;
}

export interface ResolutionLogWriter {
  record(entry: ResolutionRecord): Promise<void>;
}

/** A submission the criteria gate refused, with every failed criterion. */
export interface RejectedSubmission {
  marketId: string;
  providerEventId: string;
  failed: CriteriaResult[];
  criteria: CriteriaResult[];
}

export interface ExecutionSummary {
  frozen: number;
  resolved: number;
  voided: number;
  /** Gate refusals — NOT failures: the plan asked, the criteria said no. */
  rejected: RejectedSubmission[];
  failures: { marketId: string; error: string }[];
}

export interface ExecutionOptions {
  /** Clock for the criteria gate; defaults to wall time. */
  nowSeconds?: number;
  /** DB-backed S-024 confidence state per event; the gate falls back to the
   *  pure inline derivation when absent or null. */
  confidenceOf?: (providerEventId: string) => ConfidenceState | null;
  /** Ingest-store snapshot per event for the reconciliation precheck. */
  storedEventOf?: (providerEventId: string) => StoredEventSnapshot | null;
  /** Called for every gate refusal — the cron writes audit rows here. */
  onRejected?: (rejection: RejectedSubmission) => void | Promise<void>;
}

/**
 * Execute a plan. Failures are isolated per market: one revert must not stop
 * the rest of the slate settling, and a failed submission stays unsettled for
 * the next sweep rather than being retried in a tight loop here.
 *
 * Every resolve passes through `assertResolutionCriteria` (S-025). A refusal
 * is recorded loudly and the market stays unsettled; there is no code path
 * from here to `submitter.resolve` that skips the gate, because the gate is
 * the only mint of the authorization the submitter accepts. Voids are exempt
 * (B4-005): returning collateral cannot pick a wrong winner.
 */
export async function executeResolution(
  plan: ResolutionPlan,
  submitter: ResolutionSubmitter,
  log: ResolutionLogWriter,
  source: string,
  opts: ExecutionOptions = {},
): Promise<ExecutionSummary> {
  const summary: ExecutionSummary = {
    frozen: 0,
    resolved: 0,
    voided: 0,
    rejected: [],
    failures: [],
  };
  const nowSeconds = opts.nowSeconds ?? Math.floor(Date.now() / 1000);

  const reject = async (s: MarketSubmission, failed: CriteriaResult[], all: CriteriaResult[]) => {
    const rejection: RejectedSubmission = {
      marketId: s.marketId,
      providerEventId: s.providerEventId,
      failed,
      criteria: all,
    };
    summary.rejected.push(rejection);
    logger.error(
      {
        marketId: s.marketId,
        providerEventId: s.providerEventId,
        failed: failed.map((c) => `${c.name}: ${c.detail}`),
      },
      "resolution: criteria gate refused a resolve — market stays unsettled",
    );
    await opts.onRejected?.(rejection);
  };

  for (const marketId of plan.freezes) {
    try {
      await submitter.freeze(marketId);
      summary.frozen += 1;
    } catch (err) {
      summary.failures.push({ marketId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const s of plan.submissions) {
    try {
      // The Resolver requires FROZEN before resolve/void, and a market that
      // missed its freeze window (a game finishing between sweeps, or the
      // sweep being down over kickoff) would otherwise be stuck NotFrozen
      // forever. Freeze is idempotent — already-frozen reverts are treated
      // as done by the submitter — so sweep it in-line before settling.
      await submitter.freeze(s.marketId).catch(() => null);

      let txHash: string;
      let evidence: ResolutionRecord["evidence"];
      let confidenceState: ConfidenceState | null = null;

      if (s.kind === "resolve") {
        const ctx = s.context;
        if (!ctx || s.outcome === undefined || s.marketOutcomeIndex === undefined) {
          // A submission with no evidence attached cannot be argued for.
          await reject(
            s,
            [
              {
                name: "final_status",
                pass: false,
                detail: "submission carries no settlement context",
              },
            ],
            [],
          );
          continue;
        }
        confidenceState =
          opts.confidenceOf?.(s.providerEventId) ??
          inlineConfidence(ctx.corroboration, ctx.policy);
        const verdict = assertResolutionCriteria({
          marketId: s.marketId,
          marketOutcomeIndex: s.marketOutcomeIndex,
          outcome: s.outcome,
          event: ctx.event,
          secondaryEvent: ctx.secondaryEvent,
          corroboration: ctx.corroboration,
          policy: ctx.policy,
          confidenceState,
          slate: ctx.slate,
          secondarySlate: ctx.secondarySlate,
          storedEvent: opts.storedEventOf?.(s.providerEventId) ?? null,
          freezeCompleted: true,
          nowSeconds,
        });
        if (!verdict.ok) {
          await reject(s, verdict.failed, verdict.criteria);
          continue;
        }
        txHash = await submitter.resolve(verdict.auth);
        evidence = verdict.auth.evidence;
      } else {
        txHash = await submitter.void(s.marketId);
        evidence = s.context
          ? {
              schema: "resolution-evidence@1",
              kind: "void",
              providerEventId: s.providerEventId,
              status: s.context.event.status,
              provider: s.context.slate.provider,
              retrievedAt: new Date(s.context.slate.fetchedAt).toISOString(),
              delayed: s.context.slate.delayed,
            }
          : undefined;
      }

      await log.record({
        marketId: s.marketId,
        providerEventId: s.providerEventId,
        method: "auto",
        kind: s.kind,
        outcome: s.kind === "resolve" ? (s.outcome ?? OUTCOME_YES) : null,
        source,
        signer: submitter.signerAddress(),
        txHash,
        ...(evidence !== undefined ? { evidence } : {}),
        confidenceState,
      });

      if (s.kind === "resolve") summary.resolved += 1;
      else summary.voided += 1;
    } catch (err) {
      summary.failures.push({
        marketId: s.marketId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
