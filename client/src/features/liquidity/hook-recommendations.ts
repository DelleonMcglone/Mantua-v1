import { BASE_CHAIN_ID, type SupportedChainId } from "../../lib/chains.ts";
import { cleanEnv } from "../../lib/env.ts";
import type { TokenSymbol } from "@/lib/tokens.ts";
import type { FeeTier } from "./fee-tiers.ts";
import type { HookName } from "./use-create-pool.ts";

export const HOOK_LABELS: Record<HookName, string> = {
  "stable-protection": "Stable Protection",
  "dynamic-fee": "Dynamic Fee",
};

// `import.meta.env` only exists under Vite — node-based test runners load
// this module too, so read defensively.
const viteEnv: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

function envAddress(name: string): `0x${string}` | null {
  const v = cleanEnv(viteEnv[name]);
  return v && /^0x[a-fA-F0-9]{40}$/.test(v) ? (v as `0x${string}`) : null;
}

/**
 * Per-chain hook addresses (mirror of server v4-contracts). Used to
 * resolve a local position's hook name → address for the per-hook
 * PositionManager routing on remove-liquidity.
 *
 * Base Mainnet deployment pending — see docs/tasks/v2-roadmap.md. Until
 * the hooks deploy, addresses are `null` (hook flows degrade to the
 * no-hook path) and can be supplied via `VITE_STABLE_PROTECTION_HOOK_ADDRESS`
 * / `VITE_DYNAMIC_FEE_HOOK_ADDRESS` in `client/.env.local`.
 */
const HOOK_ADDRESS_BY_CHAIN: Record<SupportedChainId, Record<HookName, `0x${string}` | null>> = {
  [BASE_CHAIN_ID]: {
    "stable-protection": envAddress("VITE_STABLE_PROTECTION_HOOK_ADDRESS"),
    "dynamic-fee": envAddress("VITE_DYNAMIC_FEE_HOOK_ADDRESS"),
  },
};

export function getHookAddress(hook: HookName, chainId: SupportedChainId): `0x${string}` | null {
  return HOOK_ADDRESS_BY_CHAIN[chainId][hook];
}

/** LEGACY single-chain pin — prefer `getHookAddress(hook, chainId)`. */
export const HOOK_ADDRESS: Record<HookName, `0x${string}` | null> =
  HOOK_ADDRESS_BY_CHAIN[BASE_CHAIN_ID];

export const HOOK_DESCRIPTIONS: Record<HookName, string> = {
  "stable-protection":
    "FX-aware peg protection — anchors USDC/EURC to the live EUR/USD rate and blocks trades during real depegs.",
  "dynamic-fee": "Per-swap fee scales with live volatility — LPs earn more in turbulence.",
};

interface PairRecommendation {
  pair: readonly [TokenSymbol, TokenSymbol];
  hook: HookName;
}

/**
 * Canonical pool/hook pairings per chain. Defaults only — users can
 * still pick any hook the pair is allowed for (see `ALLOWED_PAIRS`).
 *  - USDC/EURC defaults to Stable Protection.
 *  - cbBTC pairs default to Dynamic Fee.
 */
const PAIR_HOOK_RECOMMENDATIONS_BY_CHAIN: Record<
  SupportedChainId,
  readonly PairRecommendation[]
> = {
  [BASE_CHAIN_ID]: [
    { pair: ["USDC", "EURC"], hook: "stable-protection" },
    { pair: ["USDC", "cbBTC"], hook: "dynamic-fee" },
    { pair: ["EURC", "cbBTC"], hook: "dynamic-fee" },
  ],
};

/**
 * Hook → allowed token pairs per chain, mirroring
 * `server/src/lib/hook-pair-gating.ts` `HOOK_ALLOWLIST`. Keep the two in
 * exact sync; the server is canonical and re-checks on every calldata
 * request.
 */
const ALLOWED_PAIRS_BY_CHAIN: Record<
  SupportedChainId,
  Record<HookName, readonly (readonly [TokenSymbol, TokenSymbol])[]>
> = {
  [BASE_CHAIN_ID]: {
    "stable-protection": [["USDC", "EURC"]],
    "dynamic-fee": [
      ["USDC", "cbBTC"],
      ["EURC", "cbBTC"],
    ],
  },
};

function pairMatches(
  a: TokenSymbol,
  b: TokenSymbol,
  [pa, pb]: readonly [TokenSymbol, TokenSymbol],
): boolean {
  return (a === pa && b === pb) || (a === pb && b === pa);
}

export function recommendedHookForPair(
  a: TokenSymbol,
  b: TokenSymbol,
  chainId: SupportedChainId,
): HookName | null {
  for (const rec of PAIR_HOOK_RECOMMENDATIONS_BY_CHAIN[chainId]) {
    if (pairMatches(a, b, rec.pair)) return rec.hook;
  }
  return null;
}

/**
 * Canonical fee tier each hook's pools are created/swapped at, mirroring
 * the Add-Liquidity + Swap flows: Stable Protection 0.01%, Dynamic Fee
 * 0.05%, no hook 0.30%. Single source of truth for the hook→fee mapping.
 */
export function feeForHook(hook: HookName | null): FeeTier {
  return hook === "stable-protection" ? 100 : hook === "dynamic-fee" ? 500 : 3000;
}

/**
 * Recover the hook bound to an existing pool from its pair + fee tier.
 * A pair's recommended hook is active only when the pool sits at that
 * hook's canonical fee tier; any other tier (e.g. 0.30%) is a no-hook
 * pool. Returns null for no-hook pools. Inverse of `feeForHook`.
 */
export function hookForPairAndFee(
  a: TokenSymbol,
  b: TokenSymbol,
  fee: FeeTier,
  chainId: SupportedChainId,
): HookName | null {
  const rec = recommendedHookForPair(a, b, chainId);
  if (!rec) return null;
  return fee === feeForHook(rec) ? rec : null;
}

/**
 * Return a user-facing reason string when a hook can't be used with
 * the given pair on the given chain, or `null` when the combo is fine.
 * Mirror of `server/src/lib/hook-pair-gating.ts` — keep the two in sync.
 * Used by AddLiquidityForm and SwapPanel to disable submit before
 * hitting the server.
 */
export function hookCompatibilityError(
  a: TokenSymbol,
  b: TokenSymbol,
  hook: HookName | null,
  chainId: SupportedChainId,
): string | null {
  if (!hook) return null;
  const allowed = ALLOWED_PAIRS_BY_CHAIN[chainId][hook];
  if (allowed.some((p) => pairMatches(a, b, p))) return null;
  if (allowed.length === 0) {
    return `${HOOK_LABELS[hook]} has no supported pairs on this network yet. Create the pool without a hook.`;
  }
  const pairs = allowed.map(([x, y]) => `${x}/${y}`).join(", ");
  return `${HOOK_LABELS[hook]} only supports ${pairs}. Pick a supported pair or create the pool without a hook.`;
}
