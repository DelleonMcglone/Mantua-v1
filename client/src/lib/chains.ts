/**
 * Supported chain: **Base Mainnet (8453)**. Per-chain config (v4
 * contracts, hook addresses, token registry, RPC URL) is keyed by
 * chainId in the modules that own each concern.
 */

import { fallback, http, type FallbackTransport } from "viem";
import { base as viemBase, type Chain } from "viem/chains";
import { cleanEnv } from "./env.ts";

// `import.meta.env` only exists under Vite — node-based test runners load
// this module too (via hook-recommendations et al.), so read defensively.
const viteEnv: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

/**
 * Base Mainnet RPC order. The same-origin server proxy (`/api/rpc`) goes
 * first: it rotates upstream hosts server-side and caches hot calls
 * (eth_gasPrice), which keeps wallet-originated RPC — including what
 * Privy's embedded wallet fetches on its own — off per-IP rate limits.
 * Public hosts remain as fallbacks (and cover non-browser contexts where
 * `window` is undefined); a `VITE_BASE_RPC_URL` override goes first.
 */
const baseRpcOverride = cleanEnv(viteEnv["VITE_BASE_RPC_URL"]);
const rpcProxyUrl = typeof window === "undefined" ? null : `${window.location.origin}/api/rpc`;
const BASE_RPC_URLS = [
  ...(baseRpcOverride ? [baseRpcOverride] : []),
  ...(rpcProxyUrl ? [rpcProxyUrl] : []),
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
];

// Inferred type (not annotated `: Chain`): Privy's PrivyClientConfig wants its
// own structurally-compatible Chain type, which viem's *generic* Chain doesn't
// unify with under exactOptionalPropertyTypes — the spread's inferred literal
// type satisfies both.
export const base = {
  ...viemBase,
  rpcUrls: {
    ...viemBase.rpcUrls,
    default: { http: BASE_RPC_URLS },
  },
  // Explicit (viem's literal omits it): Privy's Chain type reads an absent
  // `testnet` as `boolean | undefined`, which exactOptionalPropertyTypes
  // rejects against its `testnet?: boolean`.
  testnet: false,
} satisfies Chain;

export const BASE_CHAIN_ID = 8453 as const;

export const SUPPORTED_CHAIN_IDS = [BASE_CHAIN_ID] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

/** The default chain — Base Mainnet. */
export const DEFAULT_CHAIN_ID: SupportedChainId = BASE_CHAIN_ID;

export function isSupportedChainId(id: number): id is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(id);
}

export interface ChainInfo {
  id: SupportedChainId;
  shortName: string;
  displayName: string;
  viemChain: Chain;
  /** Public RPC URL. Override per env via `VITE_BASE_RPC_URL`. */
  defaultRpcUrl: string;
  /** `<base>/tx/<hash>` for transaction links; `<base>/address/<addr>` for addresses. */
  explorerUrl: string;
  explorerName: string;
  /** Brand-color dot for the chain chip. */
  dotColor: string;
}

export const CHAIN_INFO: Record<SupportedChainId, ChainInfo> = {
  [BASE_CHAIN_ID]: {
    id: BASE_CHAIN_ID,
    shortName: "Base",
    displayName: "Base",
    viemChain: base,
    defaultRpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    explorerName: "BaseScan",
    dotColor: "#0000ff",
  },
};

export function getChainInfo(chainId: SupportedChainId): ChainInfo {
  return CHAIN_INFO[chainId];
}

/**
 * Network options for the chain selector chips. Base only.
 */
export type NetworkKey = "base";

export const DEFAULT_NETWORK_KEY: NetworkKey = "base";

export function isNetworkKey(s: string): s is NetworkKey {
  return s === "base";
}

/** NetworkKey for a chain id — the logo/chip lookup. */
export function networkKeyForChain(chainId: SupportedChainId): NetworkKey {
  void chainId;
  return "base";
}

export function getExplorerTxUrl(chainId: SupportedChainId, txHash: string): string {
  return `${CHAIN_INFO[chainId].explorerUrl}/tx/${txHash}`;
}

export function getExplorerAddressUrl(chainId: SupportedChainId, address: string): string {
  return `${CHAIN_INFO[chainId].explorerUrl}/address/${address}`;
}

/**
 * Resolve the RPC URL for a chain. Overridable via `VITE_BASE_RPC_URL`
 * in `client/.env.local`.
 */
export function getRpcUrl(chainId: SupportedChainId): string {
  const override = cleanEnv(viteEnv["VITE_BASE_RPC_URL"]);
  return override || CHAIN_INFO[chainId].defaultRpcUrl;
}

/**
 * Hardened viem transport for browser-side public clients.
 *
 * Browser reads go through the same-origin `/api/rpc` proxy FIRST
 * (server-side rotation + hot-call caching keep the user's per-IP budget
 * on the public hosts intact), with the public hosts as direct fallbacks
 * and a `VITE_BASE_RPC_URL` override first.
 * Use this instead of `http(getRpcUrl(chainId))`.
 */
export function getRpcTransport(chainId: SupportedChainId): FallbackTransport {
  void chainId;
  return fallback(
    BASE_RPC_URLS.map((url) => http(url, { batch: true, retryCount: 1, retryDelay: 300 })),
  );
}
