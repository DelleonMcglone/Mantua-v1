import { and, desc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import type { DB } from "../db/client.ts";
import { activity, type Activity } from "../db/schema/activity.ts";
import { logger } from "./logger.ts";
import { notifyForActivity } from "./push/activity-bridge.ts";

/**
 * Phase 9 / PF-014 … PF-017, PF-020 — the unified Activity system.
 *
 * `activity` is the user-facing timeline ("what happened"), one append-only
 * row per financial action, written at the moment the action lands and
 * transitioned only pending → completed | failed. It is presentation
 * history; `mantua_audit_log` stays the compliance record and
 * `portfolio_transactions` keeps backing `/api/portfolio` — every writer
 * below is ADDED next to those, never instead of them.
 *
 * Idempotent: `(tx_hash, kind)` is unique, so a replayed fill report or a
 * webhook and a poll finalizing the same execution write one row.
 * Best-effort: `recordActivity` never throws into the caller's flow — a
 * timeline gap is logged, a failed trade record is not.
 */

export const ACTIVITY_KINDS = [
  "market_buy",
  "market_sell",
  "redeem",
  "settlement",
  "swap",
  "liquidity_add",
  "liquidity_remove",
  "send",
  "bridge",
  "deposit",
  "withdraw",
  "gateway_deposit",
  "gateway_spend",
  "hedge",
  "agent_research",
  "agent_simulation",
  "agent_recommendation",
  "resolution",
  // Task 072 (Phase 16) — combo tickets
  "combo_open",
  "combo_close",
  "combo_settle",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_STATUSES = ["pending", "completed", "failed"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export type ActivityActor = "user" | "agent" | "system";

export type ActivityCategory = "trade" | "liquidity" | "transfer" | "agent" | "settlement";

/** The timeline's grouping / icon key per kind (PF-019, PF-020). */
export function categoryOf(kind: ActivityKind): ActivityCategory {
  switch (kind) {
    case "market_buy":
    case "market_sell":
    case "swap":
    case "hedge":
    case "combo_open":
    case "combo_close":
      return "trade";
    case "liquidity_add":
    case "liquidity_remove":
      return "liquidity";
    case "send":
    case "bridge":
    case "deposit":
    case "withdraw":
    case "gateway_deposit":
    case "gateway_spend":
      return "transfer";
    case "agent_research":
    case "agent_simulation":
    case "agent_recommendation":
      return "agent";
    case "redeem":
    case "settlement":
    case "resolution":
    case "combo_settle":
      return "settlement";
  }
}

/** PF-017 — the one-way machine: pending → completed | failed; terminal states never move. */
export function canTransitionActivity(from: ActivityStatus, to: ActivityStatus): boolean {
  return from === "pending" && (to === "completed" || to === "failed");
}

export function isActivityKind(v: unknown): v is ActivityKind {
  return typeof v === "string" && (ACTIVITY_KINDS as readonly string[]).includes(v);
}

export interface ActivityInput {
  kind: ActivityKind;
  actor: ActivityActor;
  status?: ActivityStatus;
  userId?: string | null;
  walletAddress?: string | null;
  txHash?: string | null;
  chainId?: number;
  marketId?: string | null;
  poolId?: string | null;
  /** The position / strategy / intent the entry relates to (PF-016). */
  positionRef?: string | null;
  /** Token symbol or outcome label ("USDC", "YES", "Falcons YES"). */
  asset?: string | null;
  amountRaw?: string | null;
  valueUsd?: number | null;
  /** One line, rendered verbatim; built from the fields when omitted. */
  summary?: string;
  refId?: string | null;
  data?: Record<string, unknown>;
}

const fmtUsd = (n: number): string => `$${n.toFixed(2)}`;
const fmt6 = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const n = Number(raw) / 1e6;
  return Number.isFinite(n) ? n.toFixed(2) : null;
};

/** Pure: the default one-line summary for an entry. */
export function summarizeActivity(input: ActivityInput): string {
  const who = input.actor === "agent" ? "Agent " : "";
  const amount = fmt6(input.amountRaw);
  const value =
    input.valueUsd === null || input.valueUsd === undefined ? null : fmtUsd(input.valueUsd);
  const asset = input.asset ?? "";
  switch (input.kind) {
    case "market_buy":
      return `${who}bought ${amount ?? ""} ${asset || "YES"}${value ? ` for ${value}` : ""}`
        .replace(/\s+/g, " ")
        .trim();
    case "market_sell":
      return `${who}sold ${amount ?? ""} ${asset || "YES"}${value ? ` for ${value}` : ""}`
        .replace(/\s+/g, " ")
        .trim();
    case "redeem":
      return `${who}redeemed ${asset || "a winning position"}${value ? ` for ${value}` : ""}`;
    case "settlement":
      return `Market settled${asset ? ` — ${asset}` : ""}${value ? ` (${value})` : ""}`;
    case "resolution":
      return `Market resolved${asset ? ` — ${asset}` : ""}`;
    case "swap":
      return `${who}swapped ${asset || "tokens"}${value ? ` (${value})` : ""}`;
    case "liquidity_add":
      return `${who}added liquidity${asset ? ` to ${asset}` : ""}${value ? ` (${value})` : ""}`;
    case "liquidity_remove":
      return `${who}removed liquidity${asset ? ` from ${asset}` : ""}${value ? ` (${value})` : ""}`;
    case "send":
      return `${who}sent ${amount ?? ""} ${asset}`.replace(/\s+/g, " ").trim();
    case "bridge":
      return `${who}bridged ${amount ?? ""} ${asset || "USDC"}`.replace(/\s+/g, " ").trim();
    case "deposit":
      return `Deposited ${value ?? amount ?? ""}`.trim();
    case "withdraw":
      return `Withdrew ${value ?? amount ?? ""}`.trim();
    case "gateway_deposit":
      return `${who}deposited ${amount ?? ""} USDC to the unified balance`
        .replace(/\s+/g, " ")
        .trim();
    case "gateway_spend":
      return `${who}spent ${amount ?? ""} USDC from the unified balance`
        .replace(/\s+/g, " ")
        .trim();
    case "hedge":
      return `Agent hedged${asset ? ` ${asset}` : ""}${value ? ` (${value})` : ""}`;
    case "agent_research":
      return `Agent analyzed${asset ? ` ${asset}` : " a market"}`;
    case "agent_simulation":
      return `Agent simulated ${asset || "a trade"}${value ? ` (${value})` : ""}`;
    case "agent_recommendation":
      return `Agent recommended${asset ? ` ${asset}` : ""}`;
    case "combo_open":
      return `${who}placed a combo${asset ? ` — ${asset}` : ""}${value ? ` for ${value}` : ""}`;
    case "combo_close":
      return `${who}sold a combo position${value ? ` for ${value}` : ""}`;
    case "combo_settle":
      return `Combo settled${asset ? ` — ${asset}` : ""}${value ? ` (${value})` : ""}`;
  }
}

/**
 * The audit / execution vocabulary → the timeline kind (PF-015). Actions
 * that carry a direction (market trades, gateway) read it from params.
 */
export function kindForAction(
  action: string,
  params: Record<string, unknown> = {},
): ActivityKind | null {
  switch (action) {
    case "swap":
    case "agent_swap":
      return "swap";
    case "send_tokens":
    case "send":
    case "agent_send":
      return "send";
    case "add_liquidity":
    case "agent_add_liquidity":
      return "liquidity_add";
    case "remove_liquidity":
    case "agent_remove_liquidity":
      return "liquidity_remove";
    case "agent_bridge":
      return "bridge";
    case "agent_market_trade":
      return params["direction"] === "sell" ? "market_sell" : "market_buy";
    case "agent_gateway":
      return params["action"] === "spend" ? "gateway_spend" : "gateway_deposit";
    case "strategy_execute":
    case "strategy_close":
      return "hedge";
    case "combo_open":
      return "combo_open";
    case "combo_close":
      return "combo_close";
    case "combo_resolve":
      return "combo_settle";
    case "market_redeem":
      return "redeem";
    case "market_resolution":
      return "resolution";
    case "fiat_deposit":
      return "deposit";
    case "fiat_withdraw":
      return "withdraw";
    default:
      return null;
  }
}

/** The user's id for a timeline entry — null (never a throw) when unknown. */
export async function activityUserId(
  db: DB,
  resolve: (db: DB, privyUserId: string) => Promise<string | null>,
  privyUserId: string | undefined,
): Promise<string | null> {
  if (!privyUserId) return null;
  try {
    return await resolve(db, privyUserId);
  } catch {
    return null;
  }
}

function lower(s: string | null | undefined): string | null {
  return s ? s.toLowerCase() : null;
}

/**
 * Append one entry. Returns the row, or null when `(tx_hash, kind)` already
 * exists (a replay) or the insert failed (logged, never thrown).
 */
export async function recordActivity(db: DB, input: ActivityInput): Promise<Activity | null> {
  try {
    const rows = await db
      .insert(activity)
      .values({
        kind: input.kind,
        actor: input.actor,
        status: input.status ?? "completed",
        userId: input.userId ?? null,
        walletAddress: lower(input.walletAddress),
        txHash: lower(input.txHash),
        chainId: input.chainId ?? 8453,
        marketId: lower(input.marketId),
        poolId: lower(input.poolId),
        positionRef: input.positionRef ?? null,
        asset: input.asset ?? null,
        amountRaw: input.amountRaw ?? null,
        valueUsd:
          input.valueUsd === null || input.valueUsd === undefined
            ? null
            : input.valueUsd.toFixed(2),
        summary: input.summary ?? summarizeActivity(input),
        refId: input.refId ?? input.marketId ?? input.positionRef ?? null,
        data: input.data ?? {},
      })
      .onConflictDoNothing()
      .returning();
    const row = rows.at(0) ?? null;
    // Task 071 (MX-004) — the timeline entry is the push trigger for trade
    // confirmations, agent actions and settlement. Best-effort, never awaited.
    if (row) notifyForActivity(db, row);
    return row;
  } catch (err) {
    logger.warn({ err, kind: input.kind, txHash: input.txHash }, "activity: record failed");
    return null;
  }
}

/**
 * Move a pending entry to a terminal state (by tx hash + kind). Guarded:
 * only `pending` rows move, so the poll and the webhook finalizer cannot
 * flip a completed entry to failed or vice versa. Returns whether a row moved.
 */
export async function transitionActivity(
  db: DB,
  where: { kind: ActivityKind; txHash?: string; refId?: string },
  to: Exclude<ActivityStatus, "pending">,
  patch: {
    summary?: string;
    valueUsd?: number | null;
    data?: Record<string, unknown>;
    /** Set when the pending entry was keyed by refId and the hash is now known. */
    txHash?: string;
  } = {},
): Promise<boolean> {
  if (!where.txHash && !where.refId) return false;
  try {
    const key = where.txHash
      ? eq(activity.txHash, where.txHash.toLowerCase())
      : eq(activity.refId, where.refId ?? "");
    const rows = await db
      .update(activity)
      .set({
        status: to,
        updatedAt: new Date(),
        ...(patch.txHash !== undefined ? { txHash: patch.txHash.toLowerCase() } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.valueUsd !== undefined
          ? { valueUsd: patch.valueUsd === null ? null : patch.valueUsd.toFixed(2) }
          : {}),
        ...(patch.data !== undefined ? { data: patch.data } : {}),
      })
      .where(and(key, eq(activity.kind, where.kind), eq(activity.status, "pending")))
      .returning({ id: activity.id });
    return rows.length > 0;
  } catch (err) {
    logger.warn({ err, ...where }, "activity: transition failed");
    return false;
  }
}

export interface ActivityQuery {
  userId?: string | null;
  /** Any of these addresses (the user's wallet, the agent's wallet). */
  walletAddresses?: readonly string[];
  kinds?: readonly ActivityKind[];
  actor?: ActivityActor;
  /** Cursor: entries strictly older than this ISO timestamp. */
  before?: string;
  limit?: number;
}

/** Newest first, cursor-paged. Rows match by user id OR by wallet address. */
export async function listActivity(db: DB, q: ActivityQuery): Promise<Activity[]> {
  const limit = Math.max(1, Math.min(100, q.limit ?? 40));
  const owners = [];
  if (q.userId) owners.push(eq(activity.userId, q.userId));
  const addrs = (q.walletAddresses ?? []).map((a) => a.toLowerCase());
  if (addrs.length > 0) owners.push(inArray(activity.walletAddress, addrs));
  if (owners.length === 0) return [];
  const conds = [or(...owners)];
  if (q.kinds && q.kinds.length > 0) conds.push(inArray(activity.kind, [...q.kinds]));
  if (q.actor) conds.push(eq(activity.actor, q.actor));
  if (q.before) conds.push(lt(activity.createdAt, new Date(q.before)));
  return db
    .select()
    .from(activity)
    .where(and(...conds))
    .orderBy(desc(activity.createdAt))
    .limit(limit);
}

/** How many entries carry a tx hash but are still pending — a health number for ops. */
export async function countPendingActivity(db: DB): Promise<number> {
  const row = (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(activity)
      .where(and(eq(activity.status, "pending"), isNotNull(activity.txHash)))
  ).at(0);
  return row?.n ?? 0;
}
