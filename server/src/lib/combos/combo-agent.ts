import type { RiskLevel } from "../agent/policy.ts";
import { comboPolicyGate, type ComboGateInput, type PlatformComboLimits } from "./combo-policy.ts";
import { fairProbabilityBps, oddsMultiplier } from "./combo-pricing.ts";
import { validateLegs, type LegCandidate } from "./combo-rules.ts";

/**
 * Task 072 / CB-006 — the agent's combo proposal, in code. Legs are
 * ranked by edge (the consensus probability against the pool's price);
 * the risk level sets how many legs and how much of the per-trade limit
 * to stake; every combo rule and every policy limit applies before the
 * proposal exists. The model explains the proposal — it never picks
 * legs or sizes a stake itself.
 */

export interface EdgeCandidate extends LegCandidate {
  /** The consensus (provider) probability of this team winning, bps; null when unknown. */
  consensusBps: number | null;
}

/** Below this the pool already prices the side fairly — no edge to bundle. */
export const MIN_EDGE_BPS = 150;

const LEGS_BY_RISK: Record<RiskLevel, number> = { conservative: 2, balanced: 3, aggressive: 4 };
const STAKE_SHARE_BY_RISK: Record<RiskLevel, number> = {
  conservative: 0.25,
  balanced: 0.5,
  aggressive: 1,
};

export interface ProposalPolicy extends ComboGateInput {
  riskLevel: RiskLevel;
  maxStakePerTradeUsd: number;
}

export interface ProposalInput {
  candidates: readonly EdgeCandidate[];
  policy: ProposalPolicy;
  platform: PlatformComboLimits;
  openExposureUsd: number;
  nowSeconds: number;
}

export interface ProposedLeg {
  leg: EdgeCandidate;
  edgeBps: number;
  oddsMultiplier: number;
}

export type ComboProposal =
  | {
      ok: true;
      legs: ProposedLeg[];
      stakeUsd: number;
      fairProbabilityBps: number;
      combinedOdds: number;
      estimatedPayoutUsd: number;
      rationale: string[];
    }
  | { ok: false; reasons: string[] };

export function edgeBps(c: Pick<EdgeCandidate, "consensusBps" | "priceBps">): number | null {
  if (c.consensusBps === null || c.priceBps === null) return null;
  return c.consensusBps - c.priceBps;
}

/** The stake the risk level takes from the per-trade limit, under every cap. */
export function proposalStakeUsd(
  policy: ProposalPolicy,
  platform: PlatformComboLimits,
  openExposureUsd: number,
): number {
  const share = policy.maxStakePerTradeUsd * STAKE_SHARE_BY_RISK[policy.riskLevel];
  const headroom = Math.max(0, policy.combo.maxOpenExposureUsd - openExposureUsd);
  return Number(
    Math.min(share, policy.combo.maxStakeUsd, platform.maxStakeUsd, headroom).toFixed(2),
  );
}

export function proposeCombo(input: ProposalInput): ComboProposal {
  const { policy, platform } = input;
  const targetLegs = Math.min(
    LEGS_BY_RISK[policy.riskLevel],
    policy.combo.maxLegs,
    platform.maxLegs,
  );
  const ranked = input.candidates
    .map((leg) => ({ leg, edge: edgeBps(leg) }))
    .filter(
      (c): c is { leg: EdgeCandidate; edge: number } => c.edge !== null && c.edge >= MIN_EDGE_BPS,
    )
    .sort((a, b) => b.edge - a.edge);

  const chosen: ProposedLeg[] = [];
  const ruleOpts = {
    maxLegs: targetLegs,
    allowedLeagues: policy.allowedLeagues,
    nowSeconds: input.nowSeconds,
  };
  for (const c of ranked) {
    if (chosen.length >= targetLegs) break;
    const trial = [...chosen.map((p) => p.leg), c.leg];
    // Single-leg rules only: `too_few` clears itself as legs accumulate.
    const violations = validateLegs(trial, ruleOpts).filter((v) => v.code !== "too_few");
    if (violations.length > 0) continue;
    chosen.push({
      leg: c.leg,
      edgeBps: c.edge,
      oddsMultiplier: oddsMultiplier(c.leg.priceBps ?? 10_000),
    });
  }
  if (chosen.length < 2) {
    return {
      ok: false,
      reasons: [
        `only ${String(chosen.length)} leg(s) show an edge of at least ${String(MIN_EDGE_BPS)} bps under the policy's rules`,
      ],
    };
  }
  const stakeUsd = proposalStakeUsd(policy, platform, input.openExposureUsd);
  if (stakeUsd <= 0)
    return { ok: false, reasons: ["no combo exposure headroom left in the policy"] };
  const fair = fairProbabilityBps(chosen.map((p) => ({ priceBps: p.leg.priceBps ?? 10_000 })));
  const combinedOdds = oddsMultiplier(fair);
  const estimatedPayoutUsd = Number((stakeUsd * combinedOdds).toFixed(2));
  const gate = comboPolicyGate(policy, {
    legs: chosen.length,
    stakeUsd,
    payoutUsd: estimatedPayoutUsd,
    openExposureUsd: input.openExposureUsd,
    leagues: chosen.map((p) => p.leg.league),
    platform,
  });
  if (!gate.ok) return { ok: false, reasons: gate.reasons };
  return {
    ok: true,
    legs: chosen,
    stakeUsd,
    fairProbabilityBps: fair,
    combinedOdds,
    estimatedPayoutUsd,
    rationale: chosen.map(
      (p) =>
        `${p.leg.teamName} over ${p.leg.opponentName}: pool ${String(p.leg.priceBps)} bps vs consensus ${String(p.leg.consensusBps)} bps (+${String(p.edgeBps)} bps edge)`,
    ),
  };
}
