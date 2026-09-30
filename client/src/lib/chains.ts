/**
 * Supported chain: **Arc Mainnet (5042)** — Circle's L1 where USDC is the
 * gas token (B-005). Per-chain config (token registry, RPC URL, hook
 * addresses) is keyed by chainId in the modules that own each concern.
 * Chain identity never reaches the UI (B-004).
 */

import { defineChain, fallback, http, type Chain, type FallbackTransport } from "viem";
import { cleanEnv } from "./env.ts";

// `import.meta.env` only exists under Vite — node-based test runners load
// this module too (via hook-recommendations et al.), so read defensively.
const viteEnv: Record<string, string | undefined> =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

/**
 * Arc Mainnet RPC order. The same-origin server proxy (`/api/rpc`) goes
 * first: it rotates upstream hosts server-side and caches hot calls
 * (eth_gasPrice), which keeps wallet-originated RPC — including what
 * Privy's embedded wallet fetches on its own — off per-IP rate limits.
 * Arc's public host remains as the fallback (and covers non-browser
 * contexts where `window` is undefined); a `VITE_ARC_RPC_URL` override
 * goes first.
 */
const arcRpcOverride = cleanEnv(viteEnv["VITE_ARC_RPC_URL"]);
const rpcProxyUrl = typeof window === "undefined" ? null : `${window.location.origin}/api/rpc`;
const ARC_RPC_URLS = [
  ...(arcRpcOverride ? [arcRpcOverride] : []),
  ...(rpcProxyUrl ? [rpcProxyUrl] : []),
  "https://rpc.mainnet.arc.io",
];

/**
 * Arc Mainnet — the pinned viem ships only Arc Testnet, so mainnet is
 * defined here from docs.arc.io/arc/references/connect-to-arc. Native
 * currency is USDC at 18 decimals: the same balance the 6-decimal ERC-20
 * reads, never a second asset. Inferred type (not annotated `: Chain`):
 * Privy's PrivyClientConfig wants its own structurally-compatible Chain
 * type, which the inferred literal satisfies.
 */
export const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ARC_RPC_URLS } },
  blockExplorers: { default: { name: "Arcscan", url: "https://explorer.arc.io" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: false,
}) satisfies Chain;

export const ARC_CHAIN_ID = 5042 as const;

export const SUPPORTED_CHAIN_IDS = [ARC_CHAIN_ID] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

/** The default chain — Arc Mainnet. */
export const DEFAULT_CHAIN_ID: SupportedChainId = ARC_CHAIN_ID;

export function isSupportedChainId(id: number): id is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(id);
}

export interface ChainInfo {
  id: SupportedChainId;
  shortName: string;
  displayName: string;
  viemChain: Chain;
  /** Public RPC URL. Override per env via `VITE_ARC_RPC_URL`. */
  defaultRpcUrl: string;
  /** `<base>/tx/<hash>` for transaction links; `<base>/address/<addr>` for addresses. */
  explorerUrl: string;
  explorerName: string;
}

export const CHAIN_INFO: Record<SupportedChainId, ChainInfo> = {
  [ARC_CHAIN_ID]: {
    id: ARC_CHAIN_ID,
    shortName: "Arc",
    displayName: "Arc",
    viemChain: arc,
    defaultRpcUrl: "https://rpc.mainnet.arc.io",
    explorerUrl: "https://explorer.arc.io",
    explorerName: "Arcscan",
  },
};

export function getChainInfo(chainId: SupportedChainId): ChainInfo {
  return CHAIN_INFO[chainId];
}

export function getExplorerTxUrl(chainId: SupportedChainId, txHash: string): string {
  return `${CHAIN_INFO[chainId].explorerUrl}/tx/${txHash}`;
}

export function getExplorerAddressUrl(chainId: SupportedChainId, address: string): string {
  return `${CHAIN_INFO[chainId].explorerUrl}/address/${address}`;
}

/**
 * Resolve the RPC URL for a chain. Overridable via `VITE_ARC_RPC_URL`
 * in `client/.env.local`.
 */
export function getRpcUrl(chainId: SupportedChainId): string {
  const override = cleanEnv(viteEnv["VITE_ARC_RPC_URL"]);
  return override || CHAIN_INFO[chainId].defaultRpcUrl;
}

/**
 * Hardened viem transport for browser-side public clients.
 *
 * Browser reads go through the same-origin `/api/rpc` proxy FIRST
 * (server-side rotation + hot-call caching keep the user's per-IP budget
 * on the public host intact), with the public host as the direct fallback
 * and a `VITE_ARC_RPC_URL` override first.
 * Use this instead of `http(getRpcUrl(chainId))`.
 */
export function getRpcTransport(chainId: SupportedChainId): FallbackTransport {
  void chainId;
  return fallback(
    ARC_RPC_URLS.map((url) => http(url, { batch: true, retryCount: 1, retryDelay: 300 })),
  );
}
