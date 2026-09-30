import { ARC_CHAIN_ID, arc } from "./chains.ts";

/**
 * The active viem `Chain`. Mantua runs on Arc Mainnet only — use this
 * everywhere a wallet/public client needs a chain so the chainId checks
 * wallet providers run before signing line up.
 */
export const ACTIVE_CHAIN = arc;

export const ACTIVE_CHAIN_ID: number = ARC_CHAIN_ID;
