import { parseAbi } from "viem";

const BALANCE_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

interface BalanceReader {
  readContract: (args: {
    address: `0x${string}`;
    abi: typeof BALANCE_ABI;
    functionName: "balanceOf";
    args: readonly [`0x${string}`];
  }) => Promise<bigint>;
}

/**
 * One market's YES and NO balances for an owner, or null when the tokens
 * cannot be read.
 *
 * A market row can outlive its contracts: rows written under an earlier
 * deployment point at token addresses with no code on the live chain, and
 * `balanceOf` on them throws. One such row used to fail the whole positions
 * read, and with it the agent's portfolio. An unreadable market is not a
 * position the owner can hold, so it is skipped.
 */
export async function readOutcomeBalances(
  client: BalanceReader,
  tokens: { yesToken: string; noToken: string },
  owner: `0x${string}`,
): Promise<{ yes: bigint; no: bigint } | null> {
  try {
    const [yes, no] = await Promise.all([
      client.readContract({
        address: tokens.yesToken as `0x${string}`,
        abi: BALANCE_ABI,
        functionName: "balanceOf",
        args: [owner],
      }),
      client.readContract({
        address: tokens.noToken as `0x${string}`,
        abi: BALANCE_ABI,
        functionName: "balanceOf",
        args: [owner],
      }),
    ]);
    return { yes, no };
  } catch {
    return null;
  }
}
