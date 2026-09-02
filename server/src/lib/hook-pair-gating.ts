/**
 * Hook ↔ token-pair allowlist, chain-aware.
 *  - Base: Stable Protection USDC/EURC; Dynamic Fee cbBTC vs each
 *    stablecoin.
 * A hook must also be deployed on-chain (getHookAddress) before it can
 * be used — calling one whose address is unset throws "not deployed".
 */

import { BASE_CHAIN_ID, getChainInfo, type SupportedChainId } from "./chains.ts";
import { DEFAULT_CHAIN_ID, getHookAddress, type HookName } from "./v4-contracts.ts";
import { getTokens, ZERO_ADDRESS, type TokenSymbol } from "./tokens.ts";

type SymbolPair = readonly [TokenSymbol, TokenSymbol];

interface ChainHookAllowlist {
  /** `null` → no restriction (any pair). Missing entry → hook unavailable on this chain. */
  readonly pairs: ReadonlyArray<SymbolPair> | null;
}

/**
 * Per-chain, per-hook allowlist. A hook missing from a chain's entry
 * means the hook is not available on that chain. `pairs: null` means
 * any pair is allowed.
 */
const HOOK_ALLOWLIST: Record<
  SupportedChainId,
  Partial<Record<HookName, ChainHookAllowlist>>
> = {
  [BASE_CHAIN_ID]: {
    // Stable Protection — the FX-rate-aware showcase on the stable pair.
    "stable-protection": { pairs: [["USDC", "EURC"]] },
    // Dynamic Fee — cbBTC vs each stablecoin.
    "dynamic-fee": {
      pairs: [
        ["USDC", "cbBTC"],
        ["EURC", "cbBTC"],
      ],
    },
  },
};

function lookupSymbol(addr: string, chainId: SupportedChainId): TokenSymbol | null {
  const lower = addr.toLowerCase();
  const tokens = getTokens(chainId);
  for (const symbol of Object.keys(tokens) as TokenSymbol[]) {
    if (tokens[symbol].address.toLowerCase() === lower) return symbol;
  }
  return null;
}

function pairsMatch(a: SymbolPair, b: SymbolPair): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

/**
 * `null` → no restriction. `[]` → hook has zero allowed pairs. `undefined`
 * → hook is not available on this chain (caller should refuse).
 */
export function listAllowedPairs(
  hook: HookName,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): ReadonlyArray<SymbolPair> | null | undefined {
  const chainEntry = HOOK_ALLOWLIST[chainId];
  if (!chainEntry[hook]) return undefined;
  return chainEntry[hook].pairs;
}

export function isHookPairAllowed(
  hook: HookName,
  token0Address: string,
  token1Address: string,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): boolean {
  const allow = listAllowedPairs(hook, chainId);
  if (allow === undefined) return false; // hook not on this chain
  if (allow === null) return true; // unrestricted
  const sym0 = lookupSymbol(token0Address, chainId);
  const sym1 = lookupSymbol(token1Address, chainId);
  if (!sym0 || !sym1) return false;
  return allow.some((p) => pairsMatch(p, [sym0, sym1]));
}

function hookIncompatibilityReason(hook: HookName, chainId: SupportedChainId): string {
  const allow = listAllowedPairs(hook, chainId);
  if (allow === undefined) {
    return `Hook "${hook}" is not available on ${getChainInfo(chainId).displayName} yet. Pick a different hook.`;
  }
  if (hook === "stable-protection") {
    return "Stable Protection is only available on the USDC/EURC pair. Pick that pair or create the pool without a hook.";
  }
  // allow === null means unrestricted (any pair), in which case this
  // reason function wouldn't be reached; guard for the type-checker.
  if (allow === null) {
    return `Hook "${hook}" does not support this pair. Pick a supported pair or create the pool without a hook.`;
  }
  if (allow.length === 0) {
    return `Hook "${hook}" has no supported pairs on ${getChainInfo(chainId).displayName} yet. Create the pool without a hook.`;
  }
  const pairs = allow.map(([a, b]) => `${a}/${b}`).join(", ");
  return `Hook "${hook}" supports ${pairs}. Pick a supported pair or create the pool without a hook.`;
}

export class HookPairNotAllowedError extends Error {
  readonly hook: HookName;
  readonly chainId: SupportedChainId;
  readonly token0Address: string;
  readonly token1Address: string;
  constructor(
    hook: HookName,
    chainId: SupportedChainId,
    token0Address: string,
    token1Address: string,
  ) {
    super(hookIncompatibilityReason(hook, chainId));
    this.name = "HookPairNotAllowedError";
    this.hook = hook;
    this.chainId = chainId;
    this.token0Address = token0Address;
    this.token1Address = token1Address;
  }
}

export function assertHookPairAllowed(
  hook: HookName,
  token0Address: string,
  token1Address: string,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): void {
  if (!isHookPairAllowed(hook, token0Address, token1Address, chainId)) {
    throw new HookPairNotAllowedError(hook, chainId, token0Address, token1Address);
  }
}

export function isHookPairAllowedBySymbol(
  hook: HookName,
  symbolA: TokenSymbol,
  symbolB: TokenSymbol,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): boolean {
  const allow = listAllowedPairs(hook, chainId);
  if (allow === undefined) return false;
  if (allow === null) return true;
  return allow.some((p) => pairsMatch(p, [symbolA, symbolB]));
}

export function assertHookPairAllowedBySymbol(
  hook: HookName,
  symbolA: TokenSymbol,
  symbolB: TokenSymbol,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): void {
  if (!isHookPairAllowedBySymbol(hook, symbolA, symbolB, chainId)) {
    const tokens = getTokens(chainId);
    // A TokenSymbol may not exist in `chainId`'s registry — fall back to
    // the zero address rather than throwing while building the error.
    const addrA = symbolA in tokens ? tokens[symbolA].address : ZERO_ADDRESS;
    const addrB = symbolB in tokens ? tokens[symbolB].address : ZERO_ADDRESS;
    throw new HookPairNotAllowedError(hook, chainId, addrA, addrB);
  }
}

/**
 * Resolve a hook name to its on-chain address on the given chain and
 * gate the pair-against-hook combination. Returns `ZERO_ADDRESS` for a
 * no-hook pool. Throws when the hook is unavailable on this chain or
 * the pair is disallowed for the hook.
 */
export function resolveHookForPool(
  hook: HookName | null | undefined,
  token0Address: string,
  token1Address: string,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): `0x${string}` {
  if (!hook) return ZERO_ADDRESS;
  const addr = getHookAddress(hook, chainId);
  if (!addr) {
    throw new Error(`Hook "${hook}" is not deployed on chain ${String(chainId)} yet.`);
  }
  assertHookPairAllowed(hook, token0Address, token1Address, chainId);
  return addr;
}
