import type { HookName } from "./v4-contracts.ts";

/**
 * Estimated LP-vs-hook split of a position's accrued swap fees.
 *
 * IMPORTANT — this is an APPROXIMATION, not exact accounting. On-chain an LP
 * earns a single swap-fee stream (v4 `feeGrowthInside`); the Mantua hooks only
 * *set the fee rate* per swap, they don't pay LPs a separate "hook fee". To
 * surface "what the hook earned you" we attribute the portion of the live fee
 * ABOVE the hook's base/floor fee to the hook, and the floor to baseline LP
 * provision. Because the dynamic fee varies per swap but we only have the
 * pool's CURRENT rate plus cumulative totals, the split is an estimate. UI must
 * label it as such.
 *
 * Fee units are v4 pips where 1_000_000 = 100% (so 500 = 0.05%, 10_000 = 1%).
 */

/**
 * Per-hook BASE (floor) swap fee in v4 pips — the fee charged in "normal"
 * conditions. Anything the live fee adds on top is attributed to the hook.
 *
 * Best-effort floors; CONFIRM against the deployed hook contracts (separate
 * repos: DelleonMcglone/{stableprotection-hook,dynamic-fee}). The
 * stable-protection floor follows the landing copy: "0.05% in healthy
 * conditions ... up to 1% during severe depeg".
 */
export const HOOK_BASE_FEE_PIPS: Record<HookName, number> = {
  "stable-protection": 500, // 0.05% healthy-peg floor
  "dynamic-fee": 500, // low-volatility floor — CONFIRM exact value
};

export interface AccruedSplit {
  lp0: bigint;
  lp1: bigint;
  hook0: bigint;
  hook1: bigint;
  /** Hook-attributed share of the accrued fees, in basis points (0–10000). */
  hookShareBps: number;
}

/** Basis-point denominator (100% = 10000 bps). */
const BPS = 10_000;

/**
 * Fraction of the current fee attributable to the hook, in bps (0–10000).
 * Returns 0 — i.e. "all LP" — when there's no hook (`baseFeePips`
 * undefined), the current fee is unknown/≤0, or the current fee is at/below
 * the floor.
 */
export function hookShareBps(
  currentFeePips: number | null,
  baseFeePips: number | undefined,
): number {
  if (baseFeePips === undefined || currentFeePips === null || currentFeePips <= 0) return 0;
  const raw = ((currentFeePips - baseFeePips) / currentFeePips) * BPS;
  return Math.max(0, Math.min(BPS, Math.round(raw)));
}

/**
 * Split a position's accrued fees (raw base units) into an LP-base portion
 * and a hook-driven portion using {@link hookShareBps}. The hook portion is
 * floored (integer division); the LP portion takes the remainder so the two
 * always sum back to the input exactly.
 */
export function splitAccruedFees(
  accrued0: bigint,
  accrued1: bigint,
  currentFeePips: number | null,
  baseFeePips: number | undefined,
): AccruedSplit {
  const share = hookShareBps(currentFeePips, baseFeePips);
  const shareBig = BigInt(share);
  const hook0 = (accrued0 * shareBig) / BigInt(BPS);
  const hook1 = (accrued1 * shareBig) / BigInt(BPS);
  return { lp0: accrued0 - hook0, lp1: accrued1 - hook1, hook0, hook1, hookShareBps: share };
}

/** Human label for a hook (or plain pool) used in the grouped earnings view. */
export function hookLabel(hook: HookName | null): string {
  switch (hook) {
    case "stable-protection":
      return "Stable Protection";
    case "dynamic-fee":
      return "Dynamic Fee";
    default:
      return "Plain pool";
  }
}
