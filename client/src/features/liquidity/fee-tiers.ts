/**
 * Mirror of `server/src/lib/v4-contracts.ts` fee-tier constants.
 * Keep in sync.
 */

export const FEE_TIERS = [100, 500, 3000, 10000] as const;
export type FeeTier = (typeof FEE_TIERS)[number];

export const FEE_TIER_LABELS: Record<FeeTier, string> = {
  100: "0.01%",
  500: "0.05%",
  3000: "0.30%",
  10000: "1.00%",
};

export const FEE_TIER_HINTS: Record<FeeTier, string> = {
  100: "Stable pairs",
  500: "cbBTC / stable",
  3000: "cbBTC pairs",
  10000: "Wide range",
};

export const TICK_SPACING_BY_FEE: Record<FeeTier, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};

export const DEFAULT_FEE_TIER_FOR_PAIR = (aIsStable: boolean, bIsStable: boolean): FeeTier => {
  if (aIsStable && bIsStable) return 100;
  if (aIsStable || bIsStable) return 500;
  return 3000;
};

/**
 * Recommended fee tier for a hook + pair. DynamicFee pools are configured
 * (the hook's owner-only configurePool) at tickSpacing 60 — i.e. the 0.30%
 * tier — so that's the ONLY swappable DynamicFee tier. Steer DynamicFee
 * selections there; every other hook uses the pair-based default. `hook` is
 * the server HookName ("dynamic-fee" / …) or null for no-hook.
 */
export const recommendedFeeTier = (
  hook: string | null,
  aIsStable: boolean,
  bIsStable: boolean,
): FeeTier => {
  if (hook === "dynamic-fee") return 3000;
  return DEFAULT_FEE_TIER_FOR_PAIR(aIsStable, bIsStable);
};
