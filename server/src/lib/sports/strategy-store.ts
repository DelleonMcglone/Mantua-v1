/**
 * B9-006 — persistence for hedging strategies plus their audit trail.
 *
 * Every lifecycle transition writes a `mantua_audit_log` row alongside the
 * status change, so "why did my strategy fire/stop?" is always answerable
 * from the DB — the dashboard reads the rows, support reads the audit.
 */

import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { hedgeStrategies, type HedgeStrategy } from "../../db/schema/markets.ts";
import { mantuaAuditLog } from "../../db/schema/safety.ts";
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
  action: string,
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

export async function engineTrigger(
  db: DB,
  strategyId: string,
  detail: Record<string, unknown>,
  reason: string,
): Promise<void> {
  await db
    .update(hedgeStrategies)
    .set({ status: "triggered", triggeredAt: new Date(), updatedAt: new Date() })
    .where(and(eq(hedgeStrategies.id, strategyId), eq(hedgeStrategies.status, "armed")));
  await audit(db, "strategy_trigger", "triggered", { strategyId, ...detail }, reason);
}

/** B9-005 — a trigger that actually closed on-chain. */
export async function engineExecuted(
  db: DB,
  strategyId: string,
  detail: Record<string, unknown>,
  txHash: string,
): Promise<void> {
  await db
    .update(hedgeStrategies)
    .set({ status: "executed", executedAt: new Date(), updatedAt: new Date() })
    .where(eq(hedgeStrategies.id, strategyId));
  await db.insert(mantuaAuditLog).values({
    action: "strategy_execute",
    outcome: "executed",
    params: { strategyId, ...detail },
    txHash,
    chainId: BASE_CHAIN_ID,
  });
}
