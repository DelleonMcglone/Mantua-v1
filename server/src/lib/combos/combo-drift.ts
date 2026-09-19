import { MATERIAL_OUTPUT_SHRINK, MATERIAL_PRICE_MOVE_BPS } from "../agent/trade-simulation.ts";
import type { ComboQuoteOk, ComboQuoteResult } from "./combo-quote-types.ts";

/**
 * Task 072 / CB-006 — the material-drift rule for a confirmed combo, the
 * same thresholds as a single trade (A-030): the user confirmed a price
 * and a payout, and the execution refuses if either has moved beyond
 * them, if the legs or stake differ, or if the fresh quote is refused by
 * the rules or the policy gate.
 */
export function materialComboDrift(confirmed: ComboQuoteOk, fresh: ComboQuoteResult): string[] {
  if (!fresh.ok) {
    return fresh.violations.map((v) => `no longer allowed: ${v.detail}`);
  }
  const reasons: string[] = [];
  if (confirmed.marketId.toLowerCase() !== fresh.marketId.toLowerCase()) {
    reasons.push("the legs differ from the confirmed combo");
  }
  if (confirmed.stakeRaw !== fresh.stakeRaw)
    reasons.push("the stake differs from the confirmed combo");
  if (!fresh.gate.ok) reasons.push(...fresh.gate.reasons.map((r) => `no longer allowed: ${r}`));
  if (!fresh.deployed) reasons.push("markets are not deployed on this chain");
  if (Math.abs(fresh.effectivePriceBps - confirmed.effectivePriceBps) > MATERIAL_PRICE_MOVE_BPS) {
    reasons.push(
      `the price moved from ${String(confirmed.effectivePriceBps)} to ${String(fresh.effectivePriceBps)} bps`,
    );
  }
  const before = BigInt(confirmed.sharesRaw);
  const after = BigInt(fresh.sharesRaw);
  if (before > 0n && after < before) {
    const shrink = Number(before - after) / Number(before);
    if (shrink > MATERIAL_OUTPUT_SHRINK) {
      reasons.push(`the payout shrank by ${(shrink * 100).toFixed(1)}%`);
    }
  }
  return reasons;
}
