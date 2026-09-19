import { parseAbi } from "viem";
import { publicClientFor, useChainWalletClient } from "@/lib/privy/wallet-client.ts";
import type { BASE_CHAIN_ID } from "@/lib/chains.ts";

type ChainId = typeof BASE_CHAIN_ID;

/**
 * Task 072 — the wallet half of a server-built trade, shared by the market
 * ticket and the combo builder: a bounded approval when the allowance is
 * short (never MaxUint — the 031/C-022 principle), the signed send, and
 * the receipt wait that hands a late receipt to the pending register.
 */

const ERC20 = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** How long a ticket waits for the receipt before the pending register takes over. */
export const RECEIPT_WAIT_MS = 60_000;

export type WalletClient = NonNullable<
  Awaited<ReturnType<ReturnType<typeof useChainWalletClient>>>
>;

export interface SignedTradeCalldata {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  approvalTarget: `0x${string}` | null;
  inputToken: `0x${string}`;
  quote: { amountIn: string };
}

/** Approve exactly the trade amount when the current allowance is short. */
export async function approveIfNeeded(
  wallet: WalletClient,
  calldata: SignedTradeCalldata,
  chainId: ChainId,
  onApproving: () => void,
): Promise<void> {
  if (!calldata.approvalTarget) return;
  const owner = wallet.account.address;
  const allowance = await publicClientFor(chainId).readContract({
    address: calldata.inputToken,
    abi: ERC20,
    functionName: "allowance",
    args: [owner, calldata.approvalTarget],
  });
  if (allowance >= BigInt(calldata.quote.amountIn)) return;
  onApproving();
  const approveTx = await wallet.writeContract({
    address: calldata.inputToken,
    abi: ERC20,
    functionName: "approve",
    args: [calldata.approvalTarget, BigInt(calldata.quote.amountIn)],
  });
  await publicClientFor(chainId).waitForTransactionReceipt({ hash: approveTx });
}

/** Sign and send the server-built transaction; the hash is the trade's identity from here. */
export async function sendTrade(
  wallet: WalletClient,
  calldata: SignedTradeCalldata,
): Promise<`0x${string}`> {
  return wallet.sendTransaction({
    to: calldata.to,
    data: calldata.data,
    value: BigInt(calldata.value),
  });
}

/** `success` / `reverted`, or `late` when the receipt did not arrive in time (not a failure). */
export async function awaitTradeReceipt(
  chainId: ChainId,
  txHash: `0x${string}`,
): Promise<"success" | "reverted" | "late"> {
  try {
    const receipt = await publicClientFor(chainId).waitForTransactionReceipt({
      hash: txHash,
      timeout: RECEIPT_WAIT_MS,
      pollingInterval: 2_000,
    });
    return receipt.status === "success" ? "success" : "reverted";
  } catch {
    return "late";
  }
}
