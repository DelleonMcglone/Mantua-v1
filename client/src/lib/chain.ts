import { base } from "viem/chains";
import { BASE_CHAIN_ID } from "./chains.ts";

/**
 * The active viem `Chain`. Mantua runs on Base Mainnet only — use this
 * everywhere a wallet/public client needs a chain so the chainId checks
 * wallet providers run before signing line up.
 */
export const ACTIVE_CHAIN = base;

export const ACTIVE_CHAIN_ID: number = BASE_CHAIN_ID;
