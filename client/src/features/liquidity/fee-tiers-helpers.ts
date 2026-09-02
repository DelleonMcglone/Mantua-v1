import { FEE_TIERS, type FeeTier } from "./fee-tiers.ts";

export function isFeeTier(n: number): n is FeeTier {
  return (FEE_TIERS as readonly number[]).includes(n);
}
