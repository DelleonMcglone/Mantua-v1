/**
 * Base Mainnet chain constants — the agent talks to Base directly over
 * plain viem clients built from viem's canonical `base` chain definition
 * (id 8453, ETH gas). The RPC URL is injected (loaded from env); the
 * explorer URL feeds the tx links the actions return.
 */
export { base } from "viem/chains";

export const BASE_CHAIN_ID = 8453 as const;
export const BASE_EXPLORER_URL = "https://basescan.org" as const;
