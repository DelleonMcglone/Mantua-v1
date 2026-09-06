/**
 * B7-005 — the DM-112 routing split, in one place.
 *
 * Two swap execution paths exist and they must never cross:
 *
 * | Pair                                | Route              | Stack                                            |
 * | ----------------------------------- | ------------------ | ------------------------------------------------ |
 * | outcome token ↔ anything            | `market-pool`      | Dynamic Market PoolManager + market periphery     |
 * | base pair (registry ↔ registry)     | `universal-router` | canonical PoolManager via UniversalRouter (031)   |
 *
 * `resolveSwapRoute` is the single decision function; the market-trade
 * builder and the token-swap routes both consult it. The classification is
 * chain-agnostic (D-112): "is this token in the per-chain registry?" — no
 * chain-specific address list beyond the existing config maps.
 *
 * Outcome (YES/NO) tokens are minted per market by the MarketFactory and are
 * NEVER registry entries, so the rule "any non-registry token ⇒ market-pool"
 * fails safe: a token this server cannot identify as a base token can never
 * be routed through the base-pair path (the B7 failure condition). The
 * Trading API path (`lib/uniswap.ts`) remains the documented no-hook
 * fallback for base pairs; it takes the same `universal-router`
 * classification — nothing classified `market-pool` may reach it either.
 */

import { DEFAULT_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { getTokenByAddress } from "./tokens.ts";
import { DYNAMIC_MARKET_BY_CHAIN } from "./v4-contracts.ts";

export type SwapRoute = "market-pool" | "universal-router";

/**
 * Classify one swap by its token ADDRESSES. Both tokens in the chain's
 * registry → the base-pair path (`universal-router`); anything else —
 * an outcome token, or any address the registry doesn't know — routes
 * `market-pool`. Deliberately fail-safe in that direction: misclassifying
 * a base pair as a market pool degrades to a gated error, while the
 * reverse would sign a trade against the wrong PoolManager.
 */
export function resolveSwapRoute(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): SwapRoute {
  const inIsBase = getTokenByAddress(tokenIn, chainId) !== undefined;
  const outIsBase = getTokenByAddress(tokenOut, chainId) !== undefined;
  return inIsBase && outIsBase ? "universal-router" : "market-pool";
}

/**
 * Is this `PoolKey.hooks` address the Dynamic Market Hook on the given
 * chain? False while the DM deployment is absent (graceful gating — an
 * empty config can't match anything). Used by the base-pair swap routes
 * as the B7-005 backstop: a pool keyed to the DM hook must never be
 * quoted or encoded through the UniversalRouter path, whatever the
 * request claimed about its tokens.
 */
export function isMarketPoolHook(
  hookAddress: string,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): boolean {
  const dm = DYNAMIC_MARKET_BY_CHAIN[chainId];
  if (!dm) return false;
  return hookAddress.toLowerCase() === dm.hook.toLowerCase();
}

/** A swap was asked of the wrong path — the DM-112 split would be violated. */
export class SwapRouteMismatchError extends Error {
  constructor(expected: SwapRoute, actual: SwapRoute) {
    super(
      `This pair routes "${actual}", not "${expected}" — outcome tokens trade only ` +
        `through the market-trade path, base pairs only through the token-swap path (DM-112).`,
    );
    this.name = "SwapRouteMismatchError";
  }
}

/**
 * Assert the DM-112 classification for a path. The market-trade builder
 * calls `assertSwapRoute("market-pool", …)`; the token-swap calldata
 * route calls `assertSwapRoute("universal-router", …)`. Throws
 * `SwapRouteMismatchError` on a cross-over instead of building calldata
 * against the wrong stack.
 */
export function assertSwapRoute(
  expected: SwapRoute,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): void {
  const actual = resolveSwapRoute(tokenIn, tokenOut, chainId);
  if (actual !== expected) throw new SwapRouteMismatchError(expected, actual);
}
