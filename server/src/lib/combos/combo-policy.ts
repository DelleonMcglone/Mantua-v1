import { z } from "zod";
import { HARD_DAILY_CAP_USD } from "../constants.ts";
import { HARD_MAX_COMBO_LEGS, MIN_COMBO_LEGS } from "./combo-rules.ts";

/**
 * Task 072 / CB-010 — the user's own limits on combos, a `combo` block in
 * the agent policy's `config` beside `hedge` (D-109). Written only through
 * `PATCH /api/agent/policy`; read by the builder route, the agent's
 * proposal and the monitor. `comboPolicyGate` is the one code gate every
 * combo passes before a quote — the user's limits and the platform's.
 */

export const comboPolicySchema = z
  .object({
    /** Master switch: false refuses every combo for this user. */
    enabled: z.boolean(),
    maxLegs: z.number().int().min(MIN_COMBO_LEGS).max(HARD_MAX_COMBO_LEGS),
    /** Largest single ticket, USD. */
    maxStakeUsd: z.number().positive().max(HARD_DAILY_CAP_USD),
    /** Sum of open tickets' stakes, USD — the combined exposure ceiling. */
    maxOpenExposureUsd: z
      .number()
      .positive()
      .max(HARD_DAILY_CAP_USD * 10),
    /** Largest payout a ticket may promise, USD. */
    maxPayoutUsd: z
      .number()
      .positive()
      .max(HARD_DAILY_CAP_USD * 100),
    /** Monitor: sell the combo position once its mark reaches this (bps). */
    takeProfitBps: z.number().int().min(5_000).max(9_900),
    /** Monitor may execute for agent-wallet tickets (autonomous mode only). */
    autoManage: z.boolean(),
  })
  .strict();
export type ComboPolicy = z.infer<typeof comboPolicySchema>;

export const DEFAULT_COMBO_POLICY: ComboPolicy = {
  enabled: true,
  maxLegs: 3,
  maxStakeUsd: 25,
  maxOpenExposureUsd: 100,
  maxPayoutUsd: 1_000,
  takeProfitBps: 8_000,
  autoManage: false,
};

/** Operator limits from env, applied to every user. */
export interface PlatformComboLimits {
  maxLegs: number;
  maxStakeUsd: number;
}

export interface ComboGateInput {
  status: "active" | "paused";
  /** Empty = every league. */
  allowedLeagues: readonly string[];
  combo: ComboPolicy;
}

export interface ComboGateContext {
  legs: number;
  stakeUsd: number;
  payoutUsd: number;
  /** Stakes of this user's open tickets, USD. */
  openExposureUsd: number;
  /** Leagues of the legs (null = unknown). */
  leagues: readonly (string | null)[];
  platform: PlatformComboLimits;
}

export interface ComboGateResult {
  ok: boolean;
  reasons: string[];
}

const usd = (n: number) => `$${n.toFixed(2)}`;

export function comboPolicyGate(policy: ComboGateInput, ctx: ComboGateContext): ComboGateResult {
  const reasons: string[] = [];
  const c = policy.combo;
  if (policy.status === "paused") reasons.push("the agent's policy is paused");
  if (!c.enabled) reasons.push("combos are switched off in the policy");
  const maxLegs = Math.min(c.maxLegs, ctx.platform.maxLegs);
  if (ctx.legs > maxLegs) {
    reasons.push(`${String(ctx.legs)} legs — the limit is ${String(maxLegs)}`);
  }
  const maxStake = Math.min(c.maxStakeUsd, ctx.platform.maxStakeUsd);
  if (ctx.stakeUsd > maxStake) {
    reasons.push(`stake ${usd(ctx.stakeUsd)} is above the ${usd(maxStake)} ticket limit`);
  }
  if (ctx.openExposureUsd + ctx.stakeUsd > c.maxOpenExposureUsd) {
    reasons.push(
      `open combo exposure would be ${usd(ctx.openExposureUsd + ctx.stakeUsd)}, above the ${usd(c.maxOpenExposureUsd)} limit`,
    );
  }
  if (ctx.payoutUsd > c.maxPayoutUsd) {
    reasons.push(`payout ${usd(ctx.payoutUsd)} is above the ${usd(c.maxPayoutUsd)} limit`);
  }
  if (policy.allowedLeagues.length > 0) {
    for (const league of ctx.leagues) {
      if (league === null || !policy.allowedLeagues.includes(league)) {
        reasons.push(`${league ?? "an unknown league"} is not in the allowed leagues`);
        break;
      }
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** Pure: a stored `config.combo` (or anything) → the effective block. */
export function comboPolicyFrom(raw: unknown): ComboPolicy {
  const parsed = comboPolicySchema.partial().safeParse(raw ?? {});
  if (!parsed.success) return DEFAULT_COMBO_POLICY;
  const out: Record<string, unknown> = { ...DEFAULT_COMBO_POLICY };
  for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) out[k] = v;
  return out as ComboPolicy;
}
