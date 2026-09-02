/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
/**
 * The runtime API is identical across our viem and Privy's bundled
 * (porto) viem, but the structural types don't unify under
 * `exactOptionalPropertyTypes: true`. Typing this boundary as `any`
 * is a deliberate erasure — alternatives (module augmentation, npm
 * aliasing, large structural unions) are heavier and don't add real
 * safety since both sides are well-tested viem 2.x.
 */
import { parseAbi } from "viem";
import { ACTIVE_CHAIN } from "@/lib/chain.ts";

const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const MAX_UINT = (1n << 256n) - 1n;
/** "Effectively max" — the heuristic Uniswap's UI uses to detect a
 *  user who previously approved max and may have spent some balance. */
const FRESH_APPROVAL_THRESHOLD = 1n << 255n;

const erc20 = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/**
 * Ensure the user has approved Permit2 to spend `tokenAddr` (one-time
 * per token, ever — Permit2 is shared infrastructure across the entire
 * Uniswap stack). v4 PositionManager pulls funds via
 * `permit2.transferFrom`, so without this approval the modifyLiquidities
 * settle step reverts. No-op for native ETH (paid via msg.value).
 *
 * Returns the approval tx hash if one was sent, else null.
 */
export async function ensurePermit2Approval(
  walletClient: any,
  publicClient: any,
  tokenAddr: `0x${string}`,
  owner: `0x${string}`,
): Promise<`0x${string}` | null> {
  if (tokenAddr === ZERO) return null;
  const current = (await publicClient.readContract({
    address: tokenAddr,
    abi: erc20,
    functionName: "allowance",
    args: [owner, PERMIT2],
  })) as bigint;
  if (current >= FRESH_APPROVAL_THRESHOLD) return null;
  const txHash: `0x${string}` = await walletClient.writeContract({
    address: tokenAddr,
    abi: erc20,
    functionName: "approve",
    args: [PERMIT2, MAX_UINT],
    account: owner,
    chain: ACTIVE_CHAIN,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}
