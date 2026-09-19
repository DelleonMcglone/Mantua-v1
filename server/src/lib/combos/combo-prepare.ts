import type { DB } from "../../db/client.ts";
import type { AgentPolicyView } from "../agent/policy.ts";
import type { SupportedChainId } from "../chains.ts";
import { env } from "../../env.ts";
import {
  ensureComboMarket,
  planComboMarket,
  type ComboMarketPlan,
  type EnsureResult,
} from "./combo-market.ts";
import { latestPricesBps, legCandidatesFrom, readLegRows, type LegRef } from "./combo-read.ts";
import { validateLegs, type LegViolation } from "./combo-rules.ts";
import { playoffsLookup } from "./combo-season.ts";
import { countComboMarkets, recordComboMarket } from "./combo-store.ts";

/**
 * Task 072 / CB-005, CB-010 — the one path that creates a combo market on
 * chain, for the builder's `/prepare` and the agent's execution alike.
 * The operator's seed leaves the signer wallet here, so the gates run
 * first: the leg rules, the user's policy switch, the platform's capacity
 * (counted over every market ever prepared, not just those with a live
 * ticket). A prepared market is recorded so the count is honest across
 * ticks and users.
 */

export type PrepareResult =
  | { kind: "refused"; violations: LegViolation[] }
  | { kind: "disabled" }
  | { kind: "no_market"; missing: number }
  | { kind: "capacity"; open: number; limit: number }
  | {
      kind: "ready";
      plan: ComboMarketPlan;
      created: boolean;
      onChain: Extract<EnsureResult, { kind: "ready" }>["onChain"];
    }
  | { kind: "no_signer"; plan: ComboMarketPlan }
  | { kind: "failed"; plan: ComboMarketPlan; error: string };

export async function prepareComboMarket(
  db: DB,
  input: {
    userId: string;
    walletAddress: string;
    legs: readonly LegRef[];
    chainId: SupportedChainId;
    policy: AgentPolicyView;
    nowSeconds: number;
  },
): Promise<PrepareResult> {
  if (!input.policy.combo.enabled || input.policy.status === "paused") return { kind: "disabled" };
  const rows = await readLegRows(db, input.legs, input.chainId);
  if (rows.length !== input.legs.length) {
    return { kind: "no_market", missing: input.legs.length - rows.length };
  }
  const prices = await latestPricesBps(
    db,
    rows.map((r) => r.marketId),
  );
  const candidates = legCandidatesFrom(rows, prices, await playoffsLookup());
  const violations = validateLegs(candidates, {
    maxLegs: Math.min(env.COMBO_MAX_LEGS, input.policy.combo.maxLegs),
    allowedLeagues: input.policy.allowedLeagues,
    nowSeconds: input.nowSeconds,
  });
  if (violations.length > 0) return { kind: "refused", violations };
  const plan = planComboMarket(candidates, input.chainId);
  const open = await countComboMarkets(db);
  const known = await recordComboMarket(db, {
    userId: input.userId,
    walletAddress: input.walletAddress,
    chainId: input.chainId,
    marketId: plan.marketId,
    label: plan.label,
    startsAt: new Date(plan.startsAt * 1000),
    openingProbability: plan.openingProbability,
    dryRun: open >= env.COMBO_MAX_OPEN_MARKETS,
  });
  if (!known && open >= env.COMBO_MAX_OPEN_MARKETS) {
    return { kind: "capacity", open, limit: env.COMBO_MAX_OPEN_MARKETS };
  }
  const ensured = await ensureComboMarket(plan, input.chainId);
  if (ensured.kind === "no_signer") return { kind: "no_signer", plan };
  if (ensured.kind === "failed") return { kind: "failed", plan, error: ensured.error };
  return { kind: "ready", plan, created: ensured.created, onChain: ensured.onChain };
}
