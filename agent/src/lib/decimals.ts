/**
 * USDC decimal helpers — the USDC ERC-20 interface on Base uses 6
 * decimals. Escrow amounts and transfers route through these helpers so
 * every action converts human input the same way. (Gas is native ETH,
 * 18 decimals, handled by viem's parseEther/formatEther directly.)
 */
import { formatUnits, parseUnits } from "viem";

/** USDC ERC-20 decimals (balances, transfers, escrow amounts). */
export const USDC_DECIMALS = 6 as const;

/** Human string → 6-decimal USDC base units (e.g. "1.5" → 1_500_000n). */
export function toUsdcUnits(human: string): bigint {
  return parseUnits(human, USDC_DECIMALS);
}

/** 6-decimal USDC base units → human string (e.g. 1_500_000n → "1.5"). */
export function fromUsdcUnits(units: bigint): string {
  return formatUnits(units, USDC_DECIMALS);
}
