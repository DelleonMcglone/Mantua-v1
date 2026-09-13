/**
 * B9-006 — persistence for hedging strategies plus their audit trail.
 *
 * Every lifecycle transition writes a `mantua_audit_log` row alongside the
 * status change, so "why did my strategy fire/stop?" is always answerable
 * from the DB — the dashboard reads the rows, support reads the audit.
 */

import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { hedgeStrategies, type HedgeStrategy } from "../../db/schema/markets.ts";
import { mantuaAuditLog } from "../../db/schema/safety.ts";
import type { AuditAction } from "../../db/schema/safety.ts";
import { users } from "../../db/schema/users.ts";
import { BASE_CHAIN_ID } from "../chains.ts";
import type { StrategyConfig } from "./strategies.ts";

export async function resolveUserId(db: DB, privyUserId: string): Promise<string | null> {
  const row = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  return row.at(0)?.id ?? null;
}

function strategyType(config: StrategyConfig): string {
  if (config.kind === "delta-hedge") return "delta_hedge";
  return config.takeProfitBps !== undefined ? "take_profit" : "stop";
}

async function audit(
  db: DB,
  action: AuditAction,
  outcome: string,
  params: Record<string, unknown>,
  reason?: string,
): Promise<void> {
  await db.insert(mantuaAuditLog).values({
    action,
    outcome,
    params,
    chainId: BASE_CHAIN_ID,
    ...(reason ? { reason } : {}),
  });
}

export async function armStrategy(
  db: DB,
  userId: string,
  config: StrategyConfig,
  capUsd: number,
  expiresAt: Date | null,
): Promise<HedgeStrategy> {
  const [row] = await db
    .insert(hedgeStrategies)
    .values({
      userId,
      marketId: config.kind === "take-profit-stop" ? config.marketId : null,
      strategyType: strategyType(config),
      status: "armed",
      config,
      capUsd: capUsd.toFixed(2),
      ...(expiresAt ? { expiresAt } : {}),
    })
    .returning();
  await audit(db, "strategy_arm", "armed", { strategyId: row.id, config, capUsd });
  return row;
}

export async function listStrategies(db: DB, userId: string): Promise<HedgeStrategy[]> {
  return db
    .select()
    .from(hedgeStrategies)
    .where(eq(hedgeStrategies.userId, userId))
    .orderBy(desc(hedgeStrategies.createdAt))
    .limit(50);
}

/** User-initiated kill (B9-007). Only an armed strategy can disarm. */
export async function disarmStrategy(
  db: DB,
  userId: string,
  strategyId: string,
  reason: string,
): Promise<HedgeStrategy | null> {
  const rows = await db
    .update(hedgeStrategies)
    .set({ status: "disarmed", disarmedReason: reason.slice(0, 32), updatedAt: new Date() })
    .where(
      and(
        eq(hedgeStrategies.id, strategyId),
        eq(hedgeStrategies.userId, userId),
        eq(hedgeStrategies.status, "armed"),
      ),
    )
    .returning();
  const row = rows.at(0) ?? null;
  if (row) await audit(db, "strategy_disarm", "disarmed", { strategyId }, reason);
  return row;
}

export async function listArmed(db: DB): Promise<HedgeStrategy[]> {
  return db.select().from(hedgeStrategies).where(eq(hedgeStrategies.status, "armed"));
}

/** Engine transitions (B9-005/B9-007): disarm with reason, or mark triggered. */
export async function engineDisarm(db: DB, strategyId: string, reason: string): Promise<void> {
  await db
    .update(hedgeStrategies)
    .set({ status: "disarmed", disarmedReason: reason.slice(0, 32), updatedAt: new Date() })
    .where(and(eq(hedgeStrategies.id, strategyId), eq(hedgeStrategies.status, "armed")));
  await audit(db, "strategy_auto_disarm", "disarmed", { strategyId }, reason);
}

/**
 * B9-005 — atomic armed→triggered CLAIM (the agent-intents `executing`
 * precedent). Exactly one caller wins the guarded update; a second
 * overlapping cron gets null back and must not execute. `triggeredAt` is
 * COALESCEd so the FIRST trigger time survives a release/re-claim cycle —
 * the timestamp is set exactly once.
 */
export async function claimTriggered(
  db: DB,
  strategyId: string,
  detail: Record<string, unknown>,
  reason: string,
): Promise<HedgeStrategy | null> {
  const rows = await db
    .update(hedgeStrategies)
    .set({
      status: "triggered",
      triggeredAt: sql`coalesce(${hedgeStrategies.triggeredAt}, now())`,
      updatedAt: new Date(),
    })
    .where(and(eq(hedgeStrategies.id, strategyId), eq(hedgeStrategies.status, "armed")))
    .returning();
  const row = rows.at(0) ?? null;
  if (row) await audit(db, "strategy_trigger", "triggered", { strategyId, ...detail }, reason);
  return row;
}

/**
 * B9-005 — a trigger that actually closed on-chain. Guarded so the executed
 * timestamp and audit row are written exactly once, whichever of the poll /
 * webhook finalizers gets here first (C-015). Returns whether this call won.
 */
export async function engineExecuted(
  db: DB,
  strategyId: string,
  detail: Record<string, unknown>,
  txHash: string,
): Promise<boolean> {
  const rows = await db
    .update(hedgeStrategies)
    .set({
      status: "executed",
      executedAt: sql`coalesce(${hedgeStrategies.executedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(and(eq(hedgeStrategies.id, strategyId), ne(hedgeStrategies.status, "executed")))
    .returning();
  if (rows.length === 0) return false;
  await db.insert(mantuaAuditLog).values({
    action: "strategy_execute",
    outcome: "executed",
    params: { strategyId, ...detail },
    txHash,
    chainId: BASE_CHAIN_ID,
  });
  return true;
}

/** Executions attempted before the engine gives up and auto-disarms. */
export const MAX_EXECUTE_ATTEMPTS = 3;

/**
 * Pure retry-bound decision for a released claim: a counted attempt that
 * reaches the bound disarms; anything else re-arms for a later tick. A
 * cap-hold never counts an attempt (the daily cap resets at UTC midnight —
 * same doctrine as the intents sweep's cap-exhausted skip).
 */
export function releaseDisposition(
  priorAttempts: number,
  countAttempt: boolean,
  maxAttempts: number = MAX_EXECUTE_ATTEMPTS,
): { next: "armed" | "disarmed"; attempts: number } {
  const attempts = priorAttempts + (countAttempt ? 1 : 0);
  return attempts >= maxAttempts ? { next: "disarmed", attempts } : { next: "armed", attempts };
}

/**
 * B9-005 — release a claimed (triggered) strategy whose execution did not
 * complete: back to `armed` for a later tick, or auto-disarmed once counted
 * failures reach the bound. Guarded on `triggered` so a stale release can
 * never stomp a row another path already settled.
 */
export async function engineRelease(
  db: DB,
  claimed: HedgeStrategy,
  reason: string,
  opts: { countAttempt: boolean },
): Promise<"released" | "disarmed" | "lost"> {
  const d = releaseDisposition(claimed.executeAttempts, opts.countAttempt);
  const rows = await db
    .update(hedgeStrategies)
    .set(
      d.next === "disarmed"
        ? {
            status: "disarmed",
            disarmedReason: "execute-failed",
            executeAttempts: d.attempts,
            updatedAt: new Date(),
          }
        : { status: "armed", executeAttempts: d.attempts, updatedAt: new Date() },
    )
    .where(and(eq(hedgeStrategies.id, claimed.id), eq(hedgeStrategies.status, "triggered")))
    .returning();
  if (rows.length === 0) return "lost";
  if (d.next === "disarmed") {
    await audit(
      db,
      "strategy_auto_disarm",
      "disarmed",
      { strategyId: claimed.id, attempts: d.attempts },
      `execute-failed after ${String(d.attempts)} attempts — ${reason}`.slice(0, 256),
    );
    return "disarmed";
  }
  await audit(
    db,
    "strategy_execute",
    "released",
    { strategyId: claimed.id, attempts: d.attempts },
    reason,
  );
  return "released";
}

/**
 * B9-005 — record why a triggered strategy is waiting instead of executing
 * (user-wallet position, unprovisioned wallet, unsupported action). The row
 * stays `triggered`; this audit is what the dashboard answers "why" with.
 */
export async function auditExecutionHeld(
  db: DB,
  strategyId: string,
  detail: Record<string, unknown>,
  reason: string,
): Promise<void> {
  await audit(db, "strategy_execute", "held", { strategyId, ...detail }, reason);
}
