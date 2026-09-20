import { parseAbi } from "viem";
import type { SupportedChainId } from "../chains.ts";
import { getRpcClient } from "../rpc-client.ts";
import { readMarketPositions } from "../sports/market-positions.ts";
import { getToken, getTokens } from "../tokens.ts";

/**
 * Task 073 — the chain's own answers about a wallet: its USDC (for
 * reconciliation) and everything it holds (for the segregation move,
 * which may only replace a wallet that has nothing left in it — every app
 * token and every open market position, not just USDC).
 */

const ERC20_BALANCE_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

async function erc20BalanceOf(
  chainId: SupportedChainId,
  token: `0x${string}`,
  address: string,
): Promise<bigint> {
  return getRpcClient(chainId).readContract({
    address: token,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
}

export async function usdcBalanceOf(chainId: SupportedChainId, address: string): Promise<bigint> {
  return erc20BalanceOf(chainId, getToken("USDC", chainId).address, address);
}

export interface WalletHoldings {
  /** Non-zero app-token balances, raw units by symbol. */
  tokens: Record<string, string>;
  /** Open market positions (outcome-token balances above zero). */
  positions: number;
}

export function holdingsEmpty(h: WalletHoldings): boolean {
  return Object.keys(h.tokens).length === 0 && h.positions === 0;
}

export async function walletHoldings(
  chainId: SupportedChainId,
  address: string,
): Promise<WalletHoldings> {
  const tokens: Record<string, string> = {};
  const entries = Object.values(getTokens(chainId)).filter((t) => !t.native);
  const balances = await Promise.all(
    entries.map((t) => erc20BalanceOf(chainId, t.address, address)),
  );
  entries.forEach((t, i) => {
    if (balances[i] > 0n) tokens[t.symbol] = balances[i].toString();
  });
  const positions = (await readMarketPositions(address as `0x${string}`)).filter(
    (p) => BigInt(p.balance) > 0n,
  ).length;
  return { tokens, positions };
}
