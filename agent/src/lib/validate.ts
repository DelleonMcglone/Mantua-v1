/**
 * Shared input validation for action providers. Validates recipient
 * addresses and human-readable amounts before any transaction is built,
 * so bad input is rejected with a clear error rather than reverting
 * on-chain (or, worse, sending malformed calldata).
 */
import { isAddress } from "viem";

export function requireAddress(value: string, label = "address"): `0x${string}` {
  if (!isAddress(value, { strict: false })) {
    throw new Error(`Invalid ${label}: "${value}" is not a valid 0x address.`);
  }
  return value;
}

export function requirePositiveAmount(human: string, label = "amount"): string {
  const n = Number(human);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${label}: "${human}" must be a positive number.`);
  }
  return human;
}
