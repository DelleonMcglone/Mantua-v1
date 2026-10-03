/**
 * Client mirror of `server/src/lib/tokens.ts`. Keep in sync.
 *
 * **Arc Mainnet only** — the one supported token is USDC, which is also
 * the gas token, so there is no separate native asset. Pass `chainId`
 * explicitly (`getTokens(chainId)`) for new code; the legacy `TOKENS`
 * export resolves to the single active chain.
 */

import { ARC_CHAIN_ID, DEFAULT_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { cleanEnv } from "./env.ts";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const NETWORK: "mainnet" | "testnet" =
  cleanEnv(import.meta.env.VITE_MANTUA_NETWORK as string | undefined) === "testnet"
    ? "testnet"
    : "mainnet";
export const IS_MAINNET = NETWORK === "mainnet";

export interface Token {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  coingeckoId: string;
  native: boolean;
  chainId: number;
}

// Arc Mainnet token set — Circle's USDC, which is also the gas token, so
// there is no separate native entry: the wallet's one USDC balance covers
// trading and fees.
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

/** Legacy single-chain export. Prefer `getTokens(chainId)`. */
export const TOKENS: Record<string, Token> = TOKENS_ARC;
