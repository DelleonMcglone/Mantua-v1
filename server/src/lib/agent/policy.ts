import { and, eq, gte, isNotNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../../db/client.ts";
import { agentPolicies, type AgentPolicy } from "../../db/schema/agent.ts";
import { hedgeStrategies } from "../../db/schema/markets.ts";
import { HARD_DAILY_CAP_USD } from "../constants.ts";
import type { UserPolicyRead } from "./trade-simulation.ts";

/**
 * Phase 8 / A-003, A-012, A-038 (D-109) — the user's policy over their
 * agent. One row per user (`agent_policies`, unique on user_id); absent
 * row = the defaults below. Written ONLY through `PATCH /api/agent/policy`
 * by the authenticated user — the agent has a read tool and no write tool,
 * so it can never widen its own limits (A-012). Read by the trade
 * simulation (A-025), the turn context (autonomous mode), and the hedge
 * executor (`hedgePolicyGate`, A-038/A-041 — code, not the model).
 */

export const LAUNCH_LEAGUES = ["nfl", "wnba"] as const;
export const RISK_LEVELS = ["conservative", "balanced", "aggressive"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const hedgePolicySchema = z
  .object({
    /** Largest single hedge leg, USD. Clamps the close size. */
    maxSizeUsd: z.number().positive().max(HARD_DAILY_CAP_USD),
    /** Largest exposure the agent may hold in one market after a trade, USD. */
    maxExposureUsd: z.number().positive().max(HARD_DAILY_CAP_USD),
    /** Minimum model confidence (bps) for an unprompted hedge; 0 = not required. */
    minConfidenceBps: z.number().int().min(0).max(10_000),
    /** Minutes between two executed hedges for this user; 0 = none. */
    cooldownMinutes: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 60),
    /** Sum of hedge legs the engine may execute per UTC day, USD. */
    dailyBudgetUsd: z.number().positive().max(HARD_DAILY_CAP_USD),
    /** Market types the engine may hedge; empty = all. */
    allowedMarketTypes: z.array(z.string().min(1).max(32)).max(8),
  })
  .strict();
export type HedgePolicy = z.infer<typeof hedgePolicySchema>;

export const DEFAULT_HEDGE_POLICY: HedgePolicy = {
  maxSizeUsd: 25,
  maxExposureUsd: 100,
  minConfidenceBps: 0,
  cooldownMinutes: 0,
  dailyBudgetUsd: 100,
  allowedMarketTypes: [],
};

export interface AgentPolicyView {
  status: "active" | "paused";
  /** Unprompted execution allowed (only honored in AGENT_MODE=autonomous). */
  autoTradeEnabled: boolean;
  maxStakePerTradeUsd: number;
  riskLevel: RiskLevel;
  /** Empty = every launch league. */
  allowedLeagues: string[];
  hedge: HedgePolicy;
  updatedAt: string | null;
  /** False when no row exists yet (defaults shown). */
  persisted: boolean;
}

export const DEFAULT_POLICY: AgentPolicyView = {
  status: "active",
  autoTradeEnabled: false,
  maxStakePerTradeUsd: 25,
  riskLevel: "conservative",
  allowedLeagues: [],
  hedge: DEFAULT_HEDGE_POLICY,
  updatedAt: null,
  persisted: false,
};

export const policyPatchSchema = z
  .object({
    status: z.enum(["active", "paused"]).optional(),
    autoTradeEnabled: z.boolean().optional(),
    maxStakePerTradeUsd: z.number().positive().max(HARD_DAILY_CAP_USD).optional(),
    riskLevel: z.enum(RISK_LEVELS).optional(),
    allowedLeagues: z.array(z.enum(LAUNCH_LEAGUES)).max(8).optional(),
    hedge: hedgePolicySchema.partial().strict().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });
export type PolicyPatch = z.infer<typeof policyPatchSchema>;

/** A partial parse yields `undefined` for absent keys; spreading those would
 *  erase defaults, so keep only the keys that carry a value. */
type LooseHedgePatch = { [K in keyof HedgePolicy]?: HedgePolicy[K] | undefined };

function definedHedge(partial: LooseHedgePatch): Partial<HedgePolicy> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial) as [string, unknown][]) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function isRiskLevel(v: unknown): v is RiskLevel {
  return typeof v === "string" && (RISK_LEVELS as readonly string[]).includes(v);
}

/** Pure: a row (or none) → the view, defaults filling anything missing or malformed. */
export function viewFromRow(row: AgentPolicy | null): AgentPolicyView {
  if (!row) return DEFAULT_POLICY;
  const config =
    row.config && typeof row.config === "object" ? (row.config as Record<string, unknown>) : {};
  const hedgeParsed = hedgePolicySchema.partial().safeParse(config["hedge"] ?? {});
  const hedge: HedgePolicy = {
    ...DEFAULT_HEDGE_POLICY,
    ...(hedgeParsed.success ? definedHedge(hedgeParsed.data) : {}),
  };
  const leagues = Array.isArray(row.allowedLeagues)
    ? (row.allowedLeagues as unknown[]).filter(
        (l): l is string =>
          typeof l === "string" && (LAUNCH_LEAGUES as readonly string[]).includes(l),
      )
    : [];
  const stake = Number(row.maxStakePerTradeUsd);
  return {
    status: row.status === "paused" ? "paused" : "active",
    autoTradeEnabled: row.autoTradeEnabled,
    maxStakePerTradeUsd:
      Number.isFinite(stake) && stake > 0
        ? Math.min(stake, HARD_DAILY_CAP_USD)
        : DEFAULT_POLICY.maxStakePerTradeUsd,
    riskLevel: isRiskLevel(row.riskLevel) ? row.riskLevel : "conservative",
    allowedLeagues: leagues,
    hedge,
    updatedAt: row.updatedAt.toISOString(),
    persisted: true,
  };
}

export async function readPolicy(db: DB, userId: string): Promise<AgentPolicyView> {
  const row = (
    await db.select().from(agentPolicies).where(eq(agentPolicies.userId, userId)).limit(1)
  ).at(0);
  return viewFromRow(row ?? null);
}

/** Upsert the user's row with a validated patch; returns the new view. */
export async function updatePolicy(
  db: DB,
  userId: string,
  patch: PolicyPatch,
): Promise<AgentPolicyView> {
  const current = await readPolicy(db, userId);
  const next: AgentPolicyView = {
    ...current,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.autoTradeEnabled !== undefined ? { autoTradeEnabled: patch.autoTradeEnabled } : {}),
    ...(patch.maxStakePerTradeUsd !== undefined
      ? { maxStakePerTradeUsd: patch.maxStakePerTradeUsd }
      : {}),
    ...(patch.riskLevel !== undefined ? { riskLevel: patch.riskLevel } : {}),
    ...(patch.allowedLeagues !== undefined ? { allowedLeagues: [...patch.allowedLeagues] } : {}),
    hedge: { ...current.hedge, ...definedHedge(patch.hedge ?? {}) },
  };
  const values = {
    userId,
    status: next.status,
    autoTradeEnabled: next.autoTradeEnabled,
    maxStakePerTradeUsd: next.maxStakePerTradeUsd.toFixed(2),
    riskLevel: next.riskLevel,
    allowedLeagues: next.allowedLeagues,
    config: { hedge: next.hedge },
    updatedAt: new Date(),
  };
  const rows = await db
    .insert(agentPolicies)
    .values(values)
    .onConflictDoUpdate({ target: agentPolicies.userId, set: values })
    .returning();
  return viewFromRow(rows.at(0) ?? null);
}

/** The simulation's projection of the policy (A-025 market-policy result). */
export function toUserPolicyRead(view: AgentPolicyView): UserPolicyRead {
  return {
    status: view.status,
    maxStakePerTradeUsd: view.maxStakePerTradeUsd,
    allowedLeagues: view.allowedLeagues,
    maxExposureUsd: view.hedge.maxExposureUsd,
  };
}

// ─── A-038 / A-041 — the hedge engine's per-user gate (code, not the model) ──

export interface HedgeGateContext {
  /** The leg the engine wants to execute, USD (before clamping). */
  sizeUsd: number;
  marketType: string | null;
  /** Model confidence for the hedge, bps; null when the trigger is mechanical. */
  confidenceBps: number | null;
  /** When this user's last hedge executed (ms epoch), null if never. */
  lastHedgeAtMs: number | null;
  /** Hedge legs already executed today (UTC), USD. */
  spentTodayUsd: number;
  nowMs: number;
}

export interface HedgeGateResult {
  ok: boolean;
  /** Empty when ok. */
  reasons: string[];
  /** A later tick could pass (cooldown, budget) vs needs a person (paused, market type). */
  retryable: boolean;
  /** `sizeUsd` clamped to `hedge.maxSizeUsd`. */
  clampedSizeUsd: number;
}

export function hedgePolicyGate(view: AgentPolicyView, ctx: HedgeGateContext): HedgeGateResult {
  const reasons: string[] = [];
  let retryable = true;
  const h = view.hedge;
  if (view.status === "paused") {
    reasons.push("the agent's policy is paused");
    retryable = false;
  }
  if (
    h.allowedMarketTypes.length > 0 &&
    (ctx.marketType === null || !h.allowedMarketTypes.includes(ctx.marketType))
  ) {
    reasons.push(
      `market type ${ctx.marketType ?? "unknown"} is not permitted (allowed: ${h.allowedMarketTypes.join(", ")})`,
    );
    retryable = false;
  }
  if (
    h.minConfidenceBps > 0 &&
    (ctx.confidenceBps === null || ctx.confidenceBps < h.minConfidenceBps)
  ) {
    reasons.push(
      `confidence ${ctx.confidenceBps === null ? "unknown" : String(ctx.confidenceBps)} bps is below the policy minimum ${String(h.minConfidenceBps)} bps`,
    );
    retryable = false;
  }
  const clampedSizeUsd = Math.min(ctx.sizeUsd, h.maxSizeUsd);
  if (h.cooldownMinutes > 0 && ctx.lastHedgeAtMs !== null) {
    const readyAt = ctx.lastHedgeAtMs + h.cooldownMinutes * 60_000;
    if (ctx.nowMs < readyAt) {
      reasons.push(
        `cooldown: ${String(h.cooldownMinutes)} min between hedges, ${String(Math.ceil((readyAt - ctx.nowMs) / 60_000))} min remaining`,
      );
    }
  }
  if (ctx.spentTodayUsd + clampedSizeUsd > h.dailyBudgetUsd) {
    reasons.push(
      `daily hedge budget: $${String(h.dailyBudgetUsd)} budget, $${ctx.spentTodayUsd.toFixed(2)} used today, this leg is $${clampedSizeUsd.toFixed(2)}`,
    );
  }
  return {
    ok: reasons.length === 0,
    reasons,
    retryable: reasons.length === 0 ? true : retryable,
    clampedSizeUsd,
  };
}

export interface HedgeContext {
  view: AgentPolicyView;
  lastHedgeAtMs: number | null;
  spentTodayUsd: number;
}

/**
 * Production reader for the executor: the policy plus this user's hedge
 * history. The budget counts each hedge executed today at its strategy
 * cap — an upper bound on what it moved, deterministic without reading
 * receipts.
 */
export async function loadHedgeContext(db: DB, userId: string): Promise<HedgeContext> {
  const view = await readPolicy(db, userId);
  const last = (
    await db
      .select({ executedAt: hedgeStrategies.executedAt })
      .from(hedgeStrategies)
      .where(and(eq(hedgeStrategies.userId, userId), isNotNull(hedgeStrategies.executedAt)))
      .orderBy(desc(hedgeStrategies.executedAt))
      .limit(1)
  ).at(0);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const today = (
    await db
      .select({ total: sql<string>`coalesce(sum(${hedgeStrategies.capUsd}), 0)` })
      .from(hedgeStrategies)
      .where(and(eq(hedgeStrategies.userId, userId), gte(hedgeStrategies.executedAt, dayStart)))
  ).at(0);
  return {
    view,
    lastHedgeAtMs: last?.executedAt ? last.executedAt.getTime() : null,
    spentTodayUsd: Number(today?.total ?? 0),
  };
}
