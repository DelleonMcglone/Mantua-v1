/**
 * Phase 3 / P3-002 — supported token registry, runtime per-chain.
 *
 * Source of truth. Mirrored by `client/src/lib/tokens.ts`. Keep both in
 * sync; tokens themselves are duplicated values.
 *
 * Active set is keyed by chainId (`getTokens(chainId)`). Mainnet is
 * single-chain (Arc Mainnet, 5042), so the map holds one entry.
 *
 * Address sources:
 *   - Arc Mainnet (5042): issuer docs per P1-002 (Circle for USDC/EURC,
 *     Coinbase for cirBTC, canonical OP-stack WETH).
 */

import { ARC_CHAIN_ID, DEFAULT_CHAIN_ID, type SupportedChainId } from "./chains.ts";

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

// Arc Mainnet token set (docs.arc.io/arc/references/contract-addresses).
// USDC is ALSO the gas token: the native 18-decimal balance and this
// 6-decimal ERC-20 are one balance, so there is no separate native entry
// (native-usdc.ts converts at the edge). cirBTC (Circle-wrapped BTC) is
// BTC-pegged, so it prices off the BTC Pyth feed with bitcoin's CoinGecko
// id as fallback.
// Mirror of client/src/lib/tokens.ts — keep both in sync.
const TOKENS_ARC = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x3600000000000000000000000000000000000000",
    decimals: 6,
    coingeckoId: "usd-coin",
    pythFeedId: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    native: false,
    chainId: ARC_CHAIN_ID,
  },
  EURC: {
    symbol: "EURC",
    name: "Euro Coin",
    address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    decimals: 6,
    coingeckoId: "euro-coin",
    pythFeedId: "76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c",
    native: false,
    chainId: ARC_CHAIN_ID,
  },
  cirBTC: {
    symbol: "cirBTC",
    name: "Circle Wrapped BTC",
    address: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0",
    decimals: 8,
    coingeckoId: "bitcoin",
    pythFeedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    native: false,
    chainId: ARC_CHAIN_ID,
  },
} as const satisfies Record<string, Token>;

export type TokenSymbol = keyof typeof TOKENS_ARC;

const TOKENS_BY_CHAIN: Record<SupportedChainId, Record<string, Token>> = {
  [ARC_CHAIN_ID]: TOKENS_ARC,
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
  return Object.prototype.hasOwnProperty.call(TOKENS_ARC, s);
}

/**
 * Resolve a registry token by its contract address (case-insensitive).
 * Returns undefined for addresses outside the registry — the zero address
 * (native value) is not a registry entry and resolves to nothing.
 */
export function getTokenByAddress(
  address: string,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): Token | undefined {
  const lower = address.toLowerCase();
  return Object.values(getTokens(chainId)).find((t) => t.address.toLowerCase() === lower);
}

/** Legacy single-chain export. Prefer `getTokens(chainId)`. */
export const TOKENS: Record<string, Token> = TOKENS_ARC;

export const TOKEN_SYMBOLS = Object.keys(TOKENS) as TokenSymbol[];
