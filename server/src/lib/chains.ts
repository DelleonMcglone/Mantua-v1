/**
 * Supported chain: **Arc Mainnet (5042)** — Circle's L1 where USDC is the
 * gas token (B-005). Per-chain config (v4 contracts, hook addresses, token
 * registry) is keyed by chainId in the modules that own each concern — see
 * `v4-contracts.ts`, `tokens.ts`, `hook-pair-gating.ts`. Arc Testnet
 * (5042002) is a development target only and is never a production code
 * path (critical rule 1); it lives in `arc-chain.ts` for tooling.
 */

export const ARC_CHAIN_ID = 5042 as const;

/** Chains that can carry a user-initiated transaction. Default first. */
export const SUPPORTED_CHAIN_IDS = [ARC_CHAIN_ID] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

/** Default chain when a request omits chainId. */
export const DEFAULT_CHAIN_ID: SupportedChainId = ARC_CHAIN_ID;

export function isSupportedChainId(id: number): id is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(id);
}

export interface ChainInfo {
  id: SupportedChainId;
  shortName: string;
  displayName: string;
  /** `<base>/tx/<hash>` for transaction links; `<base>/address/<addr>` for address pages. */
  explorerUrl: string;
  /** The gas token. On Arc it is USDC itself — the native 18-decimal view
   *  of the same balance the 6-decimal ERC-20 reports (native-usdc.ts). */
  nativeSymbol: "USDC";
}

export const CHAIN_INFO: Record<SupportedChainId, ChainInfo> = {
  [ARC_CHAIN_ID]: {
    id: ARC_CHAIN_ID,
    shortName: "Arc",
    displayName: "Arc",
    // Ops-facing only (P-010): never rendered in the consumer UI.
    explorerUrl: "https://explorer.arc.io",
    nativeSymbol: "USDC",
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
