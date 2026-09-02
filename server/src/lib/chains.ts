/**
 * Supported chain: **Base Mainnet (8453)**. Per-chain config (v4
 * contracts, hook addresses, token registry) is keyed by chainId in the
 * modules that own each concern — see `v4-contracts.ts`, `tokens.ts`,
 * `hook-pair-gating.ts`.
 */

export const BASE_CHAIN_ID = 8453 as const;

/** Chains that can carry a user-initiated transaction. Default first. */
export const SUPPORTED_CHAIN_IDS = [BASE_CHAIN_ID] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

/** Default chain when a request omits chainId. */
export const DEFAULT_CHAIN_ID: SupportedChainId = BASE_CHAIN_ID;

export function isSupportedChainId(id: number): id is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(id);
}

export interface ChainInfo {
  id: SupportedChainId;
  shortName: string;
  displayName: string;
  /** `<base>/tx/<hash>` for transaction links; `<base>/address/<addr>` for address pages. */
  explorerUrl: string;
}

export const CHAIN_INFO: Record<SupportedChainId, ChainInfo> = {
  [BASE_CHAIN_ID]: {
    id: BASE_CHAIN_ID,
    shortName: "Base",
    displayName: "Base",
    explorerUrl: "https://basescan.org",
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
