/**
 * Client mirror of `server/src/lib/tokens.ts`. Keep in sync.
 *
 * **Base Mainnet only** — the supported token set is USDC / EURC / cbBTC.
 * Pass `chainId` explicitly (`getTokens(chainId)`) for new code; the
 * legacy `TOKENS` export resolves to the single active chain.
 */

import { BASE_CHAIN_ID, DEFAULT_CHAIN_ID, type SupportedChainId, CHAIN_INFO } from "./chains.ts";
import { cleanEnv } from "./env.ts";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const NETWORK: "mainnet" | "testnet" =
  cleanEnv(import.meta.env.VITE_MANTUA_NETWORK as string | undefined) === "testnet"
    ? "testnet"
    : "mainnet";
export const IS_MAINNET = NETWORK === "mainnet";

/**
 * LEGACY single-chain pin — predates multi-chain. Do NOT use in new code;
 * use the `BASE_CHAIN_ID` constant from chains.ts instead.
 */
export const ACTIVE_CHAIN_ID: SupportedChainId = BASE_CHAIN_ID;

/** LEGACY explorer pin — prefer `getExplorerTxUrl(chainId, hash)`. */
export const EXPLORER_URL = CHAIN_INFO[BASE_CHAIN_ID].explorerUrl;
export const EXPLORER_TX = `${EXPLORER_URL}/tx/`;

const V4_POSITION_MANAGER_BY_CHAIN: Record<SupportedChainId, `0x${string}`> = {
  // Base Mainnet — the canonical Uniswap v4 PositionManager. Server
  // mirror: server/src/lib/v4-contracts.ts V4_BY_CHAIN[base].
  [BASE_CHAIN_ID]: "0x7C5f5A4bBd8fD63184577525326123B519429bDc",
};

/** v4 PositionManager for the given chain. */
export function getV4PositionManager(chainId: SupportedChainId): `0x${string}` {
  return V4_POSITION_MANAGER_BY_CHAIN[chainId];
}

/** Legacy single-chain export. Prefer `getV4PositionManager(chainId)`. */
export const V4_POSITION_MANAGER: `0x${string}` = V4_POSITION_MANAGER_BY_CHAIN[BASE_CHAIN_ID];

export interface Token {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  coingeckoId: string;
  native: boolean;
  chainId: number;
}

// Base Mainnet token set — Circle's official USDC/EURC plus Coinbase
// Wrapped BTC. ETH is the gas token and is not listed as a tradeable
// entry. cbBTC is BTC-pegged, so it is priced off the
// `coinbase-wrapped-btc` CoinGecko id.
const TOKENS_BASE = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    coingeckoId: "usd-coin",
    native: false,
    chainId: BASE_CHAIN_ID,
  },
  EURC: {
    symbol: "EURC",
    name: "Euro Coin",
    address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
    decimals: 6,
    coingeckoId: "euro-coin",
    native: false,
    chainId: BASE_CHAIN_ID,
  },
  cbBTC: {
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    decimals: 8,
    coingeckoId: "coinbase-wrapped-btc",
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
 * liquidity selectors: USDC / EURC / cbBTC.
 */
export function getUserFacingTokenSymbols(chainId: SupportedChainId): TokenSymbol[] {
  return Object.keys(getTokens(chainId)) as TokenSymbol[];
}

/** Legacy single-chain export. Prefer `getTokens(chainId)`. */
export const TOKENS: Record<string, Token> = TOKENS_BASE;

export const TOKEN_SYMBOLS = Object.keys(TOKENS) as TokenSymbol[];
export const USER_FACING_TOKEN_SYMBOLS = TOKEN_SYMBOLS;
