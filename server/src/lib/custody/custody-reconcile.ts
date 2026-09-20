import { parseUnits } from "viem";

/**
 * Task 074 / IC-001 — reconciliation, the pure half. For each wallet in
 * the institution's set the runner reads the balance Circle reports for
 * the wallet and the balance the chain holds for the same address; this
 * module says whether they agree. Two independent sources — the custodian
 * API and the chain — are the point: a "matched" line is evidence, a
 * "drift" line is a question for the operator, and a missing side is
 * never called matched.
 */

export type ReconcileStatus = "matched" | "drift" | "unavailable";

export interface WalletReconciliation {
  address: string;
  circleWalletId: string;
  /** Raw USDC units (6 dp) as decimal strings; null when the read failed. */
  circleRaw: string | null;
  chainRaw: string | null;
  /** circle − chain, null unless both sides were read. */
  diffRaw: string | null;
  status: ReconcileStatus;
}

export function reconcileWallet(input: {
  address: string;
  circleWalletId: string;
  circleRaw: bigint | null;
  chainRaw: bigint | null;
}): WalletReconciliation {
  const both = input.circleRaw !== null && input.chainRaw !== null;
  const diff = both ? (input.circleRaw as bigint) - (input.chainRaw as bigint) : null;
  return {
    address: input.address,
    circleWalletId: input.circleWalletId,
    circleRaw: input.circleRaw === null ? null : input.circleRaw.toString(),
    chainRaw: input.chainRaw === null ? null : input.chainRaw.toString(),
    diffRaw: diff === null ? null : diff.toString(),
    status: diff === null ? "unavailable" : diff === 0n ? "matched" : "drift",
  };
}

/** One line of Circle's `getWalletTokenBalance` response. */
export interface CircleBalanceLine {
  amount: string;
  token: { symbol?: string; decimals?: number; tokenAddress?: string };
}

/** The USDC line, by token address, scaled to raw units; null when absent. */
export function circleUsdcRaw(lines: CircleBalanceLine[], usdcAddress: string): bigint | null {
  const want = usdcAddress.toLowerCase();
  const line = lines.find((l) => l.token.tokenAddress?.toLowerCase() === want);
  if (!line) return null;
  return parseUnits(line.amount === "" ? "0" : line.amount, line.token.decimals ?? 6);
}
