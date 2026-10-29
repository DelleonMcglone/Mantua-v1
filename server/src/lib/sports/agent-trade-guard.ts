/**
 * The agent's trade-recovery guard (owner, 2026-10-29).
 *
 * A chat trade that submits but times out before its receipt is pending,
 * not failed. The confirmation it consumed is gone, so "try again" would
 * mint a brand-new Circle transaction. Before executing, the agent path
 * checks the durable `circle_executions` ledger for the SAME trade (wallet,
 * game, side, direction, amount) submitted in the last ten minutes and
 * refuses when one is still pending or already confirmed — nothing is
 * executed twice because a confirmation was lost.
 *
 * The decision is pure (`findDuplicateTrade`); the refusal is typed so the
 * agent relays it instead of retrying.
 */

import { and, desc, eq, gte } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { circleExecutions } from "../../db/schema/circle.ts";
import { ExecutionRefusedError } from "../agent/execution-gate.ts";
import { agentTradePayloadSchema } from "../circle/finalize-agent-trade.ts";

export const AGENT_TRADE_KIND = "agent_trade" as const;
/** How long an identical trade counts as "the same one" rather than a new one. */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;

export interface TradeIdentity {
  providerEventId: string;
  outcomeIndex: 0 | 1;
  direction: "buy" | "sell";
  amountRaw: string;
}

export interface LedgerRow {
  circleTxId: string;
  status: string;
  createdAt: Date;
  payload: unknown;
}

export interface DuplicateTrade {
  circleTxId: string;
  status: "pending" | "confirmed";
  ageMs: number;
}

/**
 * The most recent pending-or-confirmed execution of `want` inside the
 * window, or null. Failed executions never count: a reverted trade may be
 * retried.
 */
export function findDuplicateTrade(
  rows: readonly LedgerRow[],
  want: TradeIdentity,
  nowMs: number,
): DuplicateTrade | null {
  for (const row of rows) {
    const ageMs = nowMs - row.createdAt.getTime();
    if (ageMs > DUPLICATE_WINDOW_MS) continue;
    if (row.status !== "pending" && row.status !== "confirmed") continue;
    const parsed = agentTradePayloadSchema.safeParse(row.payload);
    if (!parsed.success) continue;
    const p = parsed.data;
    if (
      p.providerEventId === want.providerEventId &&
      p.outcomeIndex === want.outcomeIndex &&
      p.direction === want.direction &&
      p.amountRaw === want.amountRaw
    ) {
      return { circleTxId: row.circleTxId, status: row.status, ageMs };
    }
  }
  return null;
}

/** One sentence the agent can relay verbatim. Nothing was executed. */
export function duplicateMessage(dup: DuplicateTrade, want: TradeIdentity): string {
  const what = `${want.direction} ${(Number(want.amountRaw) / 1e6).toFixed(2)} ${
    want.direction === "buy" ? "USDC of" : "YES on"
  } game ${want.providerEventId} outcome ${String(want.outcomeIndex)}`;
  const ago = `${String(Math.max(1, Math.round(dup.ageMs / 60_000)))} min ago`;
  return dup.status === "pending"
    ? `This exact trade (${what}) was submitted ${ago} and is still confirming. Nothing was executed again — it will settle on its own; check the portfolio in a minute.`
    : `This exact trade (${what}) already went through ${ago}. Nothing was executed again — to add to the position, change the amount or wait ten minutes.`;
}

/** Recent agent-trade executions for one Circle wallet, newest first. */
export async function recentAgentTrades(
  db: DB,
  circleWalletId: string,
  nowMs: number,
): Promise<LedgerRow[]> {
  return db
    .select({
      circleTxId: circleExecutions.circleTxId,
      status: circleExecutions.status,
      createdAt: circleExecutions.createdAt,
      payload: circleExecutions.payload,
    })
    .from(circleExecutions)
    .where(
      and(
        eq(circleExecutions.circleWalletId, circleWalletId),
        eq(circleExecutions.kind, AGENT_TRADE_KIND),
        gte(circleExecutions.createdAt, new Date(nowMs - DUPLICATE_WINDOW_MS)),
      ),
    )
    .orderBy(desc(circleExecutions.createdAt))
    .limit(20);
}

/** Throws a typed refusal when the same trade was already submitted. */
export async function refuseDuplicateAgentTrade(
  db: DB,
  circleWalletId: string,
  want: TradeIdentity,
  nowMs: number = Date.now(),
): Promise<void> {
  const dup = findDuplicateTrade(await recentAgentTrades(db, circleWalletId, nowMs), want, nowMs);
  if (!dup) return;
  throw new ExecutionRefusedError(
    dup.status === "pending" ? "DUPLICATE_PENDING" : "DUPLICATE_RECENT",
    duplicateMessage(dup, want),
  );
}
