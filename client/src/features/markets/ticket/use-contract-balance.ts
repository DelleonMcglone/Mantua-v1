import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { parseAbi } from "viem";
import { publicClient } from "@/lib/privy/wallet-client.ts";

const BALANCE_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

/**
 * The connected wallet's holding of one market's contract token, re-read
 * whenever the trade phase changes so Sell's Max is truthful after a fill.
 * Null until a quote reveals the token or when the read fails.
 */
export function useContractBalance(
  contractToken: `0x${string}` | undefined,
  phaseKind: string,
): bigint | null {
  const { user } = usePrivy();
  const walletAddress = user?.wallet?.address as `0x${string}` | undefined;
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    if (!contractToken || !walletAddress) return;
    publicClient
      .readContract({
        address: contractToken,
        abi: BALANCE_ABI,
        functionName: "balanceOf",
        args: [walletAddress],
      })
      .then(setBalance)
      .catch(() => {
        setBalance(null);
      });
  }, [contractToken, walletAddress, phaseKind]);
  return balance;
}
