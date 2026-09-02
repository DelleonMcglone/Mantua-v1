/**
 * Phase 3 / P3-002 — supported token registry, runtime per-chain.
 *
 * Source of truth. Mirrored by `client/src/lib/tokens.ts`. Keep both in
 * sync; tokens themselves are duplicated values.
 *
 * Active set is keyed by chainId (`getTokens(chainId)`). Mainnet is
 * single-chain (Base Mainnet, 8453), so the map holds one entry.
 *
 * Address sources:
 *   - Base Mainnet (8453): issuer docs per P1-002 (Circle for USDC/EURC,
 *     Coinbase for cbBTC, canonical OP-stack WETH).
 */

import { BASE_CHAIN_ID, DEFAULT_CHAIN_ID, type SupportedChainId } from "./chains.ts";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export interface Token {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  coingeckoId: string;
  /** Pyth Hermes feed id (lowercase hex, no 0x). Primary USD price source;
   *  DefiLlama (via coingeckoId) is the fallback. */
  pythFeedId?: string;
  native: boolean;
  chainId: number;
}

// Base Mainnet token set. ETH is the gas token; it is not listed as a
// tradeable registry entry. cbBTC (Coinbase Wrapped BTC) is BTC-pegged,
// so it prices off the BTC Pyth feed with bitcoin's CoinGecko id as
// fallback.
// Mirror of client/src/lib/tokens.ts — keep both in sync.
const TOKENS_BASE = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    coingeckoId: "usd-coin",
    pythFeedId: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    native: false,
    chainId: BASE_CHAIN_ID,
  },
  EURC: {
    symbol: "EURC",
    name: "Euro Coin",
    address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
    decimals: 6,
    coingeckoId: "euro-coin",
    pythFeedId: "76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c",
    native: false,
    chainId: BASE_CHAIN_ID,
  },
  cbBTC: {
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    decimals: 8,
    coingeckoId: "coinbase-wrapped-btc",
    pythFeedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    native: false,
    chainId: BASE_CHAIN_ID,
  },
} as const satisfies Record<string, Token>;

export type TokenSymbol = keyof typeof TOKENS_BASE;

const TOKENS_BY_CHAIN: Record<SupportedChainId, Record<string, Token>> = {
  [BASE_CHAIN_ID]: TOKENS_BASE,
};

export function getTokens(chainId: SupportedChainId): Record<string, Token> {
  return TOKENS_BY_CHAIN[chainId];
}

export function getToken(symbol: string, chainId: SupportedChainId = DEFAULT_CHAIN_ID): Token {
  const tokens = getTokens(chainId);
  // `symbol` is arbitrary input, so the index can miss at runtime; widen to
  // `| undefined` (the project has noUncheckedIndexedAccess off) to keep the
  // guard below type-correct.
  const t = tokens[symbol] as Token | undefined;
  if (!t) throw new Error(`Unknown token symbol on chain ${String(chainId)}: ${symbol}`);
  return t;
}

export function isTokenSymbol(
  s: string,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): s is TokenSymbol {
  return Object.prototype.hasOwnProperty.call(getTokens(chainId), s);
}

/**
 * Predicate that accepts a symbol on **any** supported chain. Useful
 * for request validation when chainId isn't known yet (the route then
 * narrows to the correct chain before resolving the address).
 */
export function isAnyChainTokenSymbol(s: string): s is TokenSymbol {
  return Object.prototype.hasOwnProperty.call(TOKENS_BASE, s);
}

/** Legacy single-chain export. Prefer `getTokens(chainId)`. */
export const TOKENS: Record<string, Token> = TOKENS_BASE;

export const TOKEN_SYMBOLS = Object.keys(TOKENS) as TokenSymbol[];
