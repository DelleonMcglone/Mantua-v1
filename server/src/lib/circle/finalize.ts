import { recordActivity } from "../activity.ts";
import { and, eq } from "drizzle-orm";
import type { TransactionState } from "@circle-fin/developer-controlled-wallets";
import { z } from "zod";
import { db } from "../../db/client.ts";
import { circleExecutions, webhookEvents, type CircleExecution } from "../../db/schema/circle.ts";
import { mantuaAuditLog } from "../../db/schema/safety.ts";
import { portfolioTransactions } from "../../db/schema/trading.ts";
import { BASE_CHAIN_ID } from "../chains.ts";
import { logAudit, type AuditEntry } from "../audit.ts";
import { logger } from "../logger.ts";
import { engineExecuted } from "../sports/strategy-store.ts";
import { recordSpending, reverseSpending } from "../spending-cap.ts";
import { isTerminalFailureState, isTerminalSuccessState } from "./execute.ts";

/**
 * C-015 — execution finalization.
 *
 * The sync path (receipt poll) and the durable path (webhook finalizer) race
 * on the same `circle_executions` row. Exactly one of them finalizes it:
 *
 *   1. `claimExecutionFinalization` flips the row conditionally
 *      (UPDATE … WHERE status = 'pending' RETURNING) — the loser of that
 *      race writes NOTHING, so redelivery and poll/webhook interleavings
 *      produce exactly one outcome record per execution.
 *   2. The winner builds a finalization plan (pure — unit-tested) and
 *      applies it: audit outcome, spending record/reversal, and the
 *      strategy position close.
 */

export type FinalizationSource = "poll" | "webhook";

/** `circle_executions.kind` values. Closed set — extend with the plan builder. */
export type ExecutionKind = "agent_send" | "strategy_close" | "combo_trade";

/** Expected `payload` for `kind: "agent_send"` executions. */
export const agentSendPayloadSchema = z.object({
  to: z.string(),
  symbol: z.string(),
  amountDecimal: z.string(),
  amountAtomic: z.string(),
  usdValue: z.number(),
  network: z.string(),
  agentAddress: z.string(),
  /** Set when spend was already recorded provisionally (reversed on revert). */
  provisionalSpendingUsd: z.number().nonnegative().optional(),
  auditContext: z
    .object({
      ipAddress: z.string().optional(),
      userAgent: z.string().optional(),
    })
    .optional(),
});

/** Expected `payload` for `kind: "strategy_close"` executions. */
export const strategyClosePayloadSchema = z.object({
  strategyId: z.string(),
  action: z.string(),
  marketId: z.string(),
  soldRaw: z.string(),
  usdcOutRaw: z.string(),
  reason: z.string().optional(),
});

/** Task 072 — expected `payload` for `kind: "combo_trade"` executions (the
 *  monitor's take-profit sell or hedge on an agent-wallet ticket). */
export const comboTradePayloadSchema = z.object({
  comboId: z.string().nullable(),
  userId: z.string(),
  marketId: z.string(),
  direction: z.enum(["buy", "sell"]),
  amountRaw: z.string(),
  expectedOutRaw: z.string(),
  agentAddress: z.string(),
  legs: z
    .array(
      z.object({
        providerEventId: z.string(),
        outcomeIndex: z.union([z.literal(0), z.literal(1)]),
      }),
    )
    .optional(),
  hedge: z.boolean().optional(),
});
export type ComboTradePayload = z.infer<typeof comboTradePayloadSchema>;

/** One side effect of a finalization — applied in order by `applyFinalization`. */
export type FinalizationEffect =
  | { type: "record_spend"; walletAddress: string; usdValue: number }
  | { type: "reverse_spend"; walletAddress: string; usdValue: number }
  | { type: "audit"; entry: AuditEntry }
  /** Task 072 — the webhook finalizer records a combo ticket or close itself. */
  | { type: "combo_fill"; payload: ComboTradePayload; txHash: string }
  | { type: "close_position"; strategyId: string; detail: Record<string, unknown>; txHash: string }
  | {
      type: "audit_strategy";
      outcome: string;
      reason?: string;
      params: Record<string, unknown>;
      txHash?: string;
    }
  | {
      type: "portfolio_tx";
      userId?: string;
      walletAddress: string;
      action: string;
      txHash: string;
      params: Record<string, unknown>;
      usdValue: number;
    };

export interface FinalizationPlan {
  outcome: "confirmed" | "failed";
  source: FinalizationSource;
  effects: FinalizationEffect[];
}

export interface FinalizationInput {
  kind: string;
  status: string;
  state: TransactionState;
  circleTxId: string;
  txHash: string | null;
  errorReason: string | null;
  payload: unknown;
  source: FinalizationSource;
  /** users.id of the owning agent wallet, when known (portfolio rows need it). */
  userId?: string | null;
}

/**
 * Pure decision: given a claimed execution row and the terminal state Circle
 * reported, what should be written? Returns null when nothing may be written
 * (non-terminal state, unknown kind, or a payload shape this builder cannot
 * honor — callers log those loudly instead of guessing).
 */
export function buildFinalizationPlan(input: FinalizationInput): FinalizationPlan | null {
  if (input.status !== "pending") return null; // already finalized — never again

  if (isTerminalSuccessState(input.state)) {
    if (input.kind === "agent_send") {
      const parsed = agentSendPayloadSchema.safeParse(input.payload);
      if (!parsed.success) return null;
      const p = parsed.data;
      const effects: FinalizationEffect[] = [];
      // Provisional-then-finalize semantics: a flow that recorded spend at
      // creation leaves it on the ledger here. The default (our send path)
      // records only once the receipt confirmed.
      if ((p.provisionalSpendingUsd ?? 0) <= 0 && p.usdValue > 0) {
        effects.push({ type: "record_spend", walletAddress: p.agentAddress, usdValue: p.usdValue });
      }
      effects.push({
        type: "audit",
        entry: {
          action: "agent_send",
          outcome: "success",
          txHash: input.txHash ?? undefined,
          walletAddress: p.agentAddress,
          ipAddress: p.auditContext?.ipAddress,
          userAgent: p.auditContext?.userAgent,
          params: {
            ...p,
            circleTxId: input.circleTxId,
            finalizeSource: input.source,
            finalState: input.state,
          },
        },
      });
      if (input.txHash) {
        effects.push({
          type: "portfolio_tx",
          ...(input.userId ? { userId: input.userId } : {}),
          walletAddress: p.agentAddress,
          action: "send",
          txHash: input.txHash,
          params: {
            to: p.to,
            symbol: p.symbol,
            amountDecimal: p.amountDecimal,
            amountAtomic: p.amountAtomic,
            network: p.network,
          },
          usdValue: p.usdValue,
        });
      }
      return { outcome: "confirmed", source: input.source, effects };
    }
    if (input.kind === "combo_trade") {
      const parsed = comboTradePayloadSchema.safeParse(input.payload);
      if (!parsed.success) return null;
      const p = parsed.data;
      const effects: FinalizationEffect[] = [];
      // A buy (a ticket or a hedge) spent USDC: the cap ledger is inked at
      // confirmation, exactly once, by whoever wins the finalization claim.
      if (p.direction === "buy") {
        effects.push({
          type: "record_spend",
          walletAddress: p.agentAddress,
          usdValue: Number(p.amountRaw) / 1e6,
        });
      }
      // The ticket (buy) or the close (sell) — idempotent on the tx hash.
      if (!p.hedge && input.txHash)
        effects.push({ type: "combo_fill", payload: p, txHash: input.txHash });
      effects.push(comboAuditEffect(p, input, "success"));
      return { outcome: "confirmed", source: input.source, effects };
    }
    if (input.kind === "strategy_close") {
      const parsed = strategyClosePayloadSchema.safeParse(input.payload);
      if (!parsed.success) return null;
      const p = parsed.data;
      // engineExecuted marks the strategy executed AND writes the audit row —
      // mirroring what the cron tick does for a sync-confirmed close.
      return {
        outcome: "confirmed",
        source: input.source,
        effects: [
          {
            type: "close_position",
            strategyId: p.strategyId,
            detail: {
              action: p.action,
              marketId: p.marketId,
              soldRaw: p.soldRaw,
              usdcOutRaw: p.usdcOutRaw,
              ...(p.reason ? { reason: p.reason } : {}),
              finalizeSource: input.source,
            },
            txHash: input.txHash ?? "",
          },
        ],
      };
    }
    return null;
  }

  if (isTerminalFailureState(input.state)) {
    const reason = `Circle transaction ${input.state}${input.errorReason ? `: ${input.errorReason}` : ""}`;
    if (input.kind === "agent_send") {
      const parsed = agentSendPayloadSchema.safeParse(input.payload);
      if (!parsed.success) return null;
      const p = parsed.data;
      const effects: FinalizationEffect[] = [];
      // A revert must leave NO spend on the ledger: reverse a provisional
      // record if the flow wrote one (our send path writes none — the
      // record happens only at confirm — so this is usually a no-op).
      if ((p.provisionalSpendingUsd ?? 0) > 0) {
        effects.push({
          type: "reverse_spend",
          walletAddress: p.agentAddress,
          usdValue: p.provisionalSpendingUsd as number,
        });
      }
      effects.push({
        type: "audit",
        entry: {
          action: "agent_send",
          outcome: "failure",
          txHash: input.txHash ?? undefined,
          walletAddress: p.agentAddress,
          ipAddress: p.auditContext?.ipAddress,
          userAgent: p.auditContext?.userAgent,
          reason,
          params: {
            ...p,
            circleTxId: input.circleTxId,
            finalizeSource: input.source,
            finalState: input.state,
          },
        },
      });
      return { outcome: "failed", source: input.source, effects };
    }
    if (input.kind === "combo_trade") {
      const parsed = comboTradePayloadSchema.safeParse(input.payload);
      if (!parsed.success) return null;
      return {
        outcome: "failed",
        source: input.source,
        effects: [comboAuditEffect(parsed.data, input, "failure", reason)],
      };
    }
    if (input.kind === "strategy_close") {
      const parsed = strategyClosePayloadSchema.safeParse(input.payload);
      if (!parsed.success) return null;
      // NO close_position effect — a reverted trade never closes a position.
      return {
        outcome: "failed",
        source: input.source,
        effects: [
          {
            type: "audit_strategy",
            outcome: "failure",
            reason,
            ...(input.txHash ? { txHash: input.txHash } : {}),
            params: {
              ...parsed.data,
              finalizeSource: input.source,
              finalState: input.state,
            },
          },
        ],
      };
    }
    return null;
  }

  // Non-terminal state — neither path may finalize from it.
  return null;
}

/** The one effect a combo execution finalizes with: its audit row (the
 *  ticket itself is stamped by the monitor from the receipt it awaited). */
function comboAuditEffect(
  p: z.infer<typeof comboTradePayloadSchema>,
  input: FinalizationInput,
  outcome: "success" | "failure",
  reason?: string,
): FinalizationEffect {
  return {
    type: "audit",
    entry: {
      action: "combo_manage",
      outcome,
      txHash: input.txHash ?? undefined,
      walletAddress: p.agentAddress,
      ...(reason ? { reason } : {}),
      params: {
        ...p,
        circleTxId: input.circleTxId,
        finalizeSource: input.source,
        finalState: input.state,
      },
    },
  };
}

/** Apply a plan's effects in order. Throws on the first failed write. */
export async function applyFinalization(plan: FinalizationPlan): Promise<void> {
  for (const effect of plan.effects) {
    switch (effect.type) {
      case "record_spend":
        await recordSpending(effect.walletAddress, effect.usdValue);
        break;
      case "reverse_spend":
        await reverseSpending(effect.walletAddress, effect.usdValue);
        break;
      case "audit":
        await logAudit(effect.entry);
        break;
      case "combo_fill": {
        const p = effect.payload;
        const { recordComboFill } = await import("../combos/combo-fill.ts");
        await recordComboFill(db, {
          userId: p.userId,
          walletAddress: p.agentAddress,
          chainId: BASE_CHAIN_ID,
          marketId: p.marketId as `0x${string}`,
          direction: p.direction,
          tokensRaw: BigInt(p.direction === "buy" ? p.expectedOutRaw : p.amountRaw),
          usdcRaw: BigInt(p.direction === "buy" ? p.amountRaw : p.expectedOutRaw),
          txHash: effect.txHash,
          legs: p.legs ?? [],
          source: "agent",
          mode: "autonomous",
        });
        break;
      }
      case "close_position":
        await engineExecuted(db, effect.strategyId, effect.detail, effect.txHash);
        break;
      case "audit_strategy":
        // Same raw insert shape strategy-store uses ("executed"/"failure" on
        // strategy_execute are not in the typed AuditOutcome union).
        await db.insert(mantuaAuditLog).values({
          action: "strategy_execute",
          outcome: effect.outcome,
          params: effect.params,
          chainId: BASE_CHAIN_ID,
          ...(effect.txHash ? { txHash: effect.txHash } : {}),
          ...(effect.reason ? { reason: effect.reason } : {}),
        });
        break;
      case "portfolio_tx":
        await recordSendPortfolioTx({
          ...(effect.userId ? { userId: effect.userId } : {}),
          walletAddress: effect.walletAddress,
          action: effect.action,
          txHash: effect.txHash,
          params: effect.params,
          usdValue: effect.usdValue,
        });
        break;
    }
  }
}

/**
 * Shared on-chain history insert for confirmed agent sends — used by the
 * poll path (agent-send lib) and the webhook finalizer's portfolio_tx
 * effect. Skipped (with a warning) when the wallet has no users.id: the
 * table requires one. txHash is unique, so a stray second write fails loud
 * rather than double-counting.
 */
export async function recordSendPortfolioTx(row: {
  userId?: string;
  walletAddress: string;
  action: string;
  txHash: string;
  params: Record<string, unknown>;
  usdValue: number;
}): Promise<void> {
  if (!row.userId) {
    logger.warn(
      { txHash: row.txHash },
      "portfolio_tx skipped: agent wallet has no users.id — cannot record on-chain history",
    );
    return;
  }
  await db.insert(portfolioTransactions).values({
    userId: row.userId,
    walletAddress: row.walletAddress,
    action: row.action,
    txHash: row.txHash,
    params: row.params,
    outcome: "success",
    usdValue: row.usdValue > 0 ? row.usdValue.toFixed(2) : null,
  });
}

/**
 * Atomically claim the right to finalize a pending execution.
 *   "won"    — this call flipped the row pending → terminal; apply the plan.
 *   "lost"   — the row exists but is already terminal: another path (webhook
 *              redelivery, the poll, a concurrent notification) finalized it;
 *              write NOTHING.
 *   "absent" — no row exists (or a non-terminal state): the caller owns the
 *              outcome (legacy executions) or must not finalize (webhook).
 * The conditional UPDATE is the exactly-once guarantee.
 */
export async function claimExecutionFinalization(
  circleTxId: string,
  source: FinalizationSource,
  state: TransactionState,
  notificationId?: string,
): Promise<"won" | "lost" | "absent"> {
  const outcome = isTerminalSuccessState(state)
    ? "confirmed"
    : isTerminalFailureState(state)
      ? "failed"
      : null;
  if (!outcome) return "absent";
  const rows = await db
    .update(circleExecutions)
    .set({
      status: outcome,
      finalState: state,
      finalizeSource: source,
      finalizedAt: new Date(),
      updatedAt: new Date(),
      ...(notificationId ? { notificationId } : {}),
    })
    .where(and(eq(circleExecutions.circleTxId, circleTxId), eq(circleExecutions.status, "pending")))
    .returning({ id: circleExecutions.id });
  return rows.length > 0 ? "won" : "lost";
}

/**
 * Persist a pending execution row at Circle-create time so a timed-out poll
 * (frozen lambda, network partition) still leaves the webhook finalizer
 * something to resolve. Insert-once: the Circle tx id is unique.
 */
export async function recordPendingExecution(row: {
  circleTxId: string;
  kind: ExecutionKind;
  action: string;
  userId?: string;
  walletAddress?: string;
  circleWalletId?: string;
  payload: unknown;
}): Promise<void> {
  await db
    .insert(circleExecutions)
    .values({
      circleTxId: row.circleTxId,
      kind: row.kind,
      action: row.action,
      status: "pending",
      payload: row.payload,
      ...(row.userId ? { userId: row.userId } : {}),
      ...(row.walletAddress ? { walletAddress: row.walletAddress } : {}),
      ...(row.circleWalletId ? { circleWalletId: row.circleWalletId } : {}),
    })
    .onConflictDoNothing({ target: circleExecutions.circleTxId });
  // Task 062 / PF-017 — an agent send enters the timeline as `pending` the
  // moment Circle accepts it; the webhook or the poll path moves it to
  // completed / failed (keyed by the Circle tx id until the hash is known).
  if (row.kind === "agent_send") {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    await recordActivity(db, {
      kind: "send",
      actor: "agent",
      status: "pending",
      userId: row.userId ?? null,
      walletAddress: row.walletAddress ?? null,
      refId: row.circleTxId,
      asset: typeof p["symbol"] === "string" ? p["symbol"] : null,
      amountRaw: typeof p["amountAtomic"] === "string" ? p["amountAtomic"] : null,
      valueUsd: typeof p["usdValue"] === "number" ? p["usdValue"] : null,
      data: { to: typeof p["to"] === "string" ? p["to"] : null, circleTxId: row.circleTxId },
    });
  }
}

/**
 * Record a raw notification delivery. Returns false on redelivery (the
 * notification id is unique) — the storage-level exactly-once for webhooks.
 */
export async function recordWebhookEvent(row: {
  notificationId: string;
  eventType?: string;
  circleTxId?: string;
  payload?: unknown;
}): Promise<boolean> {
  const inserted = await db
    .insert(webhookEvents)
    .values({
      notificationId: row.notificationId,
      ...(row.eventType ? { eventType: row.eventType } : {}),
      ...(row.circleTxId ? { circleTxId: row.circleTxId } : {}),
      ...(row.payload !== undefined ? { payload: row.payload } : {}),
    })
    .onConflictDoNothing({ target: webhookEvents.notificationId })
    .returning({ id: webhookEvents.id });
  return inserted.length > 0;
}

/** Fetch an execution by Circle transaction id (null when unknown). */
export async function getExecutionByCircleTxId(
  circleTxId: string,
): Promise<CircleExecution | null> {
  const rows = await db
    .select()
    .from(circleExecutions)
    .where(eq(circleExecutions.circleTxId, circleTxId))
    .limit(1);
  return rows.at(0) ?? null;
}

/** Log-and-skip for webhook notifications that reference unknown executions. */
export function warnUnknownExecution(circleTxId: string, notificationId: string): void {
  logger.warn(
    { circleTxId, notificationId },
    "circle webhook: no execution row for this transaction — skipping (200 so Circle stops retrying)",
  );
}
