/**
 * B4-006 — the Drizzle-backed resolution log, and the DB reconcile that keeps
 * `markets` rows in step with what actually happened on-chain. Task 040 adds
 * the S-024 confidence-review store and the S-026 evidence persistence.
 *
 * One row per settlement action, written only after a transaction hash exists.
 * The chain is the record and the DB reflects it (spec §3.5) — which is why
 * `record` takes the hash as an input rather than writing an intent row first
 * and filling it in later: there is no state in which the log claims something
 * the chain has not done.
 */

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { events, markets, resolutionReviews, resolutions } from "../../db/schema/index.ts";
import { logger } from "../logger.ts";
import {
  type ConfidenceState,
  RECONCILIATION_TIMEOUT_SECONDS,
  nextConfidenceState,
  observationFor,
} from "./resolution-confidence.ts";
import type { StoredEventSnapshot } from "./resolution-freshness.ts";
import type { EventAssessment, ResolutionLogWriter, ResolutionRecord } from "./resolution.ts";

/**
 * Map the service's vocabulary onto the schema's `method` column, which
 * predates it: `auto` for an automated resolve, `void` for a void (the schema
 * treats void as its own method with a null outcome), `manual` reserved for
 * operator overrides recorded by hand.
 */
function methodFor(record: ResolutionRecord): "auto" | "void" {
  return record.kind === "void" ? "void" : "auto";
}

/** Append one step to a review's jsonb history without read-modify-write. */
function appendHistory(state: string, at: Date, reason: string) {
  return sql`${resolutionReviews.history} || ${JSON.stringify([
    { state, at: at.toISOString(), reason },
  ])}::jsonb`;
}

export function drizzleResolutionLog(db: DB, chainId = 8453): ResolutionLogWriter {
  return {
    async record(entry: ResolutionRecord): Promise<void> {
      await db.insert(resolutions).values({
        marketId: entry.marketId,
        winningOutcomeIndex: entry.outcome,
        method: methodFor(entry),
        source: entry.source,
        // S-026: the full evidence bundle IS the source payload. Pre-040
        // behaviour (bare provider event id) remains the fallback so a void
        // without context still writes an honest row.
        sourcePayload: entry.evidence ?? { providerEventId: entry.providerEventId },
        signer: entry.signer,
        txHash: entry.txHash,
        confidenceState: entry.confidenceState ?? null,
      });

      // Reconcile the market row. `onConflictDoNothing`-style tolerance: the
      // row may not exist yet if market creation lagged the event feed, and a
      // missing row must not fail the log write that records a real tx.
      await db
        .update(markets)
        .set(
          entry.kind === "void"
            ? { state: "INVALID", resolvedAt: new Date() }
            : { state: "RESOLVED", resolvedAt: new Date() },
        )
        .where(eq(markets.marketId, entry.marketId));

      // S-024: a landed resolve advances the game's review VERIFIED →
      // RESOLVED. Conditional on VERIFIED so the transition table cannot be
      // bypassed at the SQL level; the second market of the pair finds the
      // row already RESOLVED, which the gate accepts.
      if (entry.kind === "resolve") {
        const now = new Date();
        await db
          .update(resolutionReviews)
          .set({
            state: "RESOLVED",
            reason: `resolved_onchain: tx ${entry.txHash}`,
            resolvedAt: now,
            updatedAt: now,
            history: appendHistory("RESOLVED", now, `resolved_onchain: tx ${entry.txHash}`),
          })
          .where(
            and(
              eq(resolutionReviews.providerEventId, entry.providerEventId),
              eq(resolutionReviews.chainId, chainId),
              eq(resolutionReviews.state, "VERIFIED"),
            ),
          );
      }
    },
  };
}

// ─── S-024 — confidence-review sync ────────────────────────────────────────

export interface ConfidenceSyncResult {
  /** Post-sync state per provider event id, for the criteria gate. */
  states: Map<string, ConfidenceState>;
  /** Events whose pending reconciliation outlived the timeout this pass. */
  escalated: string[];
  /** Events whose state changed this pass, with the transition reason. */
  changed: { providerEventId: string; state: ConfidenceState; reason: string }[];
}

/**
 * Advance the persisted confidence state machine with one pass's
 * assessments, and escalate timed-out PENDING_RECONCILIATION rows to
 * MANUAL_REVIEW. All transitions go through `nextConfidenceState` — this
 * function only persists what the machine decides.
 */
export async function syncConfidenceReviews(
  db: DB,
  assessments: readonly EventAssessment[],
  opts: { chainId: number; now?: Date },
): Promise<ConfidenceSyncResult> {
  const now = opts.now ?? new Date();
  const result: ConfidenceSyncResult = { states: new Map(), escalated: [], changed: [] };

  // 1. Bounded timeout (S-024): a single-source final that never
  //    corroborated stops waiting and asks a human. Time-based, so it runs
  //    even on passes where the feed is delayed or the event vanished.
  const timedOut = await db
    .update(resolutionReviews)
    .set({
      state: "MANUAL_REVIEW",
      reason: "reconciliation_timeout: corroboration never arrived",
      escalatedAt: now,
      updatedAt: now,
      history: appendHistory(
        "MANUAL_REVIEW",
        now,
        "reconciliation_timeout: corroboration never arrived",
      ),
    })
    .where(
      and(
        eq(resolutionReviews.chainId, opts.chainId),
        eq(resolutionReviews.state, "PENDING_RECONCILIATION"),
        lt(
          resolutionReviews.firstFinalSeenAt,
          new Date(now.getTime() - RECONCILIATION_TIMEOUT_SECONDS * 1000),
        ),
      ),
    )
    .returning({ providerEventId: resolutionReviews.providerEventId });
  for (const row of timedOut) {
    result.escalated.push(row.providerEventId);
    result.states.set(row.providerEventId, "MANUAL_REVIEW");
    logger.error(
      { providerEventId: row.providerEventId, chainId: opts.chainId },
      "resolution: reconciliation timed out — escalated to MANUAL_REVIEW",
    );
  }

  // 2. Per-assessment advancement.
  for (const a of assessments) {
    if (a.settlement.kind === "void") continue; // voids are confidence-exempt (B4-005)

    const winner =
      a.settlement.kind === "resolve"
        ? a.settlement.winningOutcomeIndex
        : a.corroboration?.kind === "agreed"
          ? a.corroboration.winningOutcomeIndex
          : -1;
    const obs =
      a.settlement.kind === "resolve"
        ? observationFor(a.corroboration, a.policy, winner)
        : a.corroboration && a.corroboration.kind !== "agreed"
          ? observationFor(a.corroboration, a.policy, winner)
          : null;
    if (obs === null) {
      // A held final with nothing decisive to observe (e.g. final without
      // scores under single-source policy) advances nothing.
      continue;
    }

    const existing = await db.query.resolutionReviews.findFirst({
      where: and(
        eq(resolutionReviews.providerEventId, a.providerEventId),
        eq(resolutionReviews.chainId, opts.chainId),
      ),
    });

    const current = (existing?.state ?? null) as ConfidenceState | null;
    const step = nextConfidenceState(current, obs);

    if (step.state === null) continue;
    if (!existing) {
      await db.insert(resolutionReviews).values({
        providerEventId: a.providerEventId,
        chainId: opts.chainId,
        state: step.state,
        policy: a.policy,
        reason: step.reason,
        winningOutcomeIndex: winner >= 0 ? winner : null,
        firstFinalSeenAt: now,
        ...(step.state === "DISPUTED" ? { disputedAt: now } : {}),
        history: [{ state: step.state, at: now.toISOString(), reason: step.reason }],
      });
      result.changed.push({ providerEventId: a.providerEventId, state: step.state, reason: step.reason });
    } else if (step.changed) {
      await db
        .update(resolutionReviews)
        .set({
          state: step.state,
          reason: step.reason,
          updatedAt: now,
          ...(winner >= 0 ? { winningOutcomeIndex: winner } : {}),
          ...(step.state === "DISPUTED" ? { disputedAt: now } : {}),
          ...(step.state === "MANUAL_REVIEW" ? { escalatedAt: now } : {}),
          history: appendHistory(step.state, now, step.reason),
        })
        .where(eq(resolutionReviews.id, existing.id));
      result.changed.push({ providerEventId: a.providerEventId, state: step.state, reason: step.reason });
      if (step.state === "DISPUTED" || step.state === "MANUAL_REVIEW") {
        logger.error(
          { providerEventId: a.providerEventId, state: step.state, reason: step.reason },
          "resolution: confidence escalated — will not auto-resolve",
        );
      }
    }
    result.states.set(a.providerEventId, step.state);
  }

  return result;
}

// ─── S-022 — ingest-store snapshots for the reconciliation precheck ────────

/**
 * The ingest worker's persisted view of the given events, keyed by provider
 * event id. Feeds `reconcileWithStoredEvent` via the criteria gate.
 */
export async function loadStoredEvents(
  db: DB,
  provider: string,
  providerEventIds: readonly string[],
): Promise<Map<string, StoredEventSnapshot>> {
  const out = new Map<string, StoredEventSnapshot>();
  if (providerEventIds.length === 0) return out;
  const rows = await db
    .select({
      providerEventId: events.providerEventId,
      status: events.status,
      homeScore: events.homeScore,
      awayScore: events.awayScore,
      lastPolledAt: events.lastPolledAt,
    })
    .from(events)
    .where(and(eq(events.provider, provider), inArray(events.providerEventId, [...providerEventIds])));
  for (const r of rows) {
    out.set(r.providerEventId, {
      status: r.status,
      homeScore: r.homeScore,
      awayScore: r.awayScore,
      lastPolledAt: r.lastPolledAt,
    });
  }
  return out;
}
