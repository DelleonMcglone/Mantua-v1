/**
 * Client mirror of `server/src/lib/tokens.ts`. Keep in sync.
 *
 * **Arc Mainnet only** — the supported token set is USDC / EURC / cirBTC; USDC is also the gas token, so there is no separate native asset.
 * Pass `chainId` explicitly (`getTokens(chainId)`) for new code; the
 * legacy `TOKENS` export resolves to the single active chain.
 */

import { ARC_CHAIN_ID, DEFAULT_CHAIN_ID, type SupportedChainId, CHAIN_INFO } from "./chains.ts";
import { cleanEnv } from "./env.ts";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const NETWORK: "mainnet" | "testnet" =
  cleanEnv(import.meta.env.VITE_MANTUA_NETWORK as string | undefined) === "testnet"
    ? "testnet"
    : "mainnet";
export const IS_MAINNET = NETWORK === "mainnet";

/**
 * LEGACY single-chain pin — predates multi-chain. Do NOT use in new code;
 * use the `ARC_CHAIN_ID` constant from chains.ts instead.
 */
export const ACTIVE_CHAIN_ID: SupportedChainId = ARC_CHAIN_ID;

/** LEGACY explorer pin — prefer `getExplorerTxUrl(chainId, hash)`. */
export const EXPLORER_URL = CHAIN_INFO[ARC_CHAIN_ID].explorerUrl;
export const EXPLORER_TX = `${EXPLORER_URL}/tx/`;

// Arc has no canonical Uniswap v4 deployment (server mirror:
// server/src/lib/v4-contracts.ts V4_BY_CHAIN is empty), so the canonical
// PositionManager is null and base-pair liquidity surfaces degrade on it.
const V4_POSITION_MANAGER_BY_CHAIN: Record<SupportedChainId, `0x${string}` | null> = {
  [ARC_CHAIN_ID]: null,
};

/** Canonical v4 PositionManager for the given chain, or null when none. */
export function getV4PositionManager(chainId: SupportedChainId): `0x${string}` | null {
  return V4_POSITION_MANAGER_BY_CHAIN[chainId];
}

/** Legacy single-chain export. Prefer `getV4PositionManager(chainId)`. */
export const V4_POSITION_MANAGER: `0x${string}` | null = V4_POSITION_MANAGER_BY_CHAIN[ARC_CHAIN_ID];

export interface Token {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  coingeckoId: string;
  native: boolean;
  chainId: number;
}

// Arc Mainnet token set — Circle's USDC/EURC plus Circle-wrapped BTC
// (cirBTC). USDC is also the gas token, so there is no separate native
// entry: the wallet's one USDC balance covers trading and fees. cirBTC is
// BTC-pegged, so it is priced off the `bitcoin` CoinGecko id.
const TOKENS_ARC = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x3600000000000000000000000000000000000000",
    decimals: 6,
    coingeckoId: "usd-coin",
    native: false,
    chainId: ARC_CHAIN_ID,
  },
  EURC: {
    symbol: "EURC",
    name: "Euro Coin",
    address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    decimals: 6,
    coingeckoId: "euro-coin",
    native: false,
    chainId: ARC_CHAIN_ID,
  },
  cirBTC: {
    symbol: "cirBTC",
    name: "Circle Wrapped BTC",
    address: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0",
    decimals: 8,
    coingeckoId: "bitcoin",
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
  // `symbol` is arbitrary input (user / chat), so the index can miss at
  // runtime. The map is typed `Record<string, Token>` and the project has
  // `noUncheckedIndexedAccess` off, so cast to `| undefined` to keep the
  // runtime guard below type-correct (and the throw reachable).
  const t = tokens[symbol] as Token | undefined;
  if (!t) throw new Error(`Unknown token on chain ${String(chainId)}: ${symbol}`);
  return t;
}

export function isTokenSymbol(
  s: string,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): s is TokenSymbol {
  return Object.prototype.hasOwnProperty.call(getTokens(chainId), s);
}

/**
 * User-facing token list for a given chain — what shows in the swap /
 * liquidity selectors: USDC / EURC / cirBTC.
 */
export function getUserFacingTokenSymbols(chainId: SupportedChainId): TokenSymbol[] {
  return Object.keys(getTokens(chainId)) as TokenSymbol[];
}

/** Legacy single-chain export. Prefer `getTokens(chainId)`. */
export const TOKENS: Record<string, Token> = TOKENS_ARC;

export const TOKEN_SYMBOLS = Object.keys(TOKENS) as TokenSymbol[];
export const USER_FACING_TOKEN_SYMBOLS = TOKEN_SYMBOLS;
