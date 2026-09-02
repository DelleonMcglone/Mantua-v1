import { desc, eq } from "drizzle-orm";
import { type Address, parseAbi } from "viem";
import { db } from "../db/client.ts";
import { portfolioTransactions, type PortfolioTransaction } from "../db/schema/trading.ts";
import { AgentWalletNotFoundError, getAgentWallet } from "./agent-wallet.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { getRpcClient } from "./rpc-client.ts";
import { getTokens, type Token, type TokenSymbol } from "./tokens.ts";
import { tokenAmountUsd } from "./usd-pricing.ts";
import { readOnchainPositions } from "./v4-onchain-positions.ts";
import { logger } from "./logger.ts";

const ERC20_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

export interface AgentBalance {
  symbol: TokenSymbol;
  address: `0x${string}`;
  decimals: number;
  balanceRaw: string;
  usdValue: number;
}

/** One of the agent wallet's open LP positions (read live on-chain). */
export interface AgentPositionRow {
  tokenId: string;
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: number;
  /** Hook name powering the pool, or null for a no-hook pool. */
  hook: string | null;
  amountA: string;
  amountB: string;
  /** Uncollected swap fees (raw base units). */
  fees0: string;
  fees1: string;
}

export interface AgentPortfolio {
  address: string;
  balances: AgentBalance[];
  positions: AgentPositionRow[];
  transactions: PortfolioTransaction[];
}

/**
 * P6-008 — agent wallet balances + recent tx history.
 *
 * Balances are read live from the chain via baseRpcClient; native ETH
 * via getBalance, ERC-20s via balanceOf. USD values come from the
 * existing tokenAmountUsd helper (CoinGecko, 60s cached). All four
 * supported tokens are always returned, even at zero balance, so the UI
 * can render a stable list.
 *
 * Transactions are pulled from `portfolio_transactions` filtered to the
 * agent address — the same table the user-side records into, so user
 * and agent histories sit in one ledger.
 */
export async function getAgentPortfolio(
  privyUserId: string,
  txLimit = 50,
  chainId: SupportedChainId = BASE_CHAIN_ID,
): Promise<AgentPortfolio> {
  const wallet = await getAgentWallet(privyUserId, chainId);
  if (!wallet) throw new AgentWalletNotFoundError(privyUserId);

  const agentAddress = wallet.address as Address;
  const client = getRpcClient(chainId);
  const tokens = Object.entries(getTokens(chainId)) as [TokenSymbol, Token][];

  const balances = await Promise.all(
    tokens.map(async ([symbol, t]) => {
      const raw = t.native
        ? await client.getBalance({ address: agentAddress })
        : await client.readContract({
            address: t.address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [agentAddress],
          });
      const usdValue = await tokenAmountUsd(symbol, raw);
      return {
        symbol,
        address: t.address,
        decimals: t.decimals,
        balanceRaw: raw.toString(),
        usdValue,
      };
    }),
  );

  // Open LP positions, read live on-chain for the agent address. Degrade to an
  // empty list on a read error rather than failing the whole portfolio.
  let positions: AgentPositionRow[] = [];
  try {
    const onchain = await readOnchainPositions(agentAddress, chainId);
    positions = onchain.map((p) => ({
      tokenId: p.tokenId,
      tokenA: p.tokenA,
      tokenB: p.tokenB,
      fee: p.fee,
      hook: p.hook,
      amountA: p.amountA,
      amountB: p.amountB,
      fees0: p.fees0,
      fees1: p.fees1,
    }));
  } catch (err) {
    logger.warn({ err, agentAddress }, "agent-portfolio: on-chain positions read failed");
  }

  const transactions = await db
    .select()
    .from(portfolioTransactions)
    .where(eq(portfolioTransactions.walletAddress, wallet.address))
    .orderBy(desc(portfolioTransactions.createdAt))
    .limit(txLimit);

  return {
    address: wallet.address,
    balances,
    positions,
    transactions,
  };
}
