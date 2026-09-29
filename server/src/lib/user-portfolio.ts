import { desc, eq } from "drizzle-orm";
import { type Address, parseAbi } from "viem";
import { db } from "../db/client.ts";
import { portfolioTransactions, type PortfolioTransaction } from "../db/schema/trading.ts";
import { userPreferences, users } from "../db/schema/users.ts";
import { DEFAULT_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { logger } from "./logger.ts";
import { getRpcClient } from "./rpc-client.ts";
import { getTokens, type Token, type TokenSymbol } from "./tokens.ts";
import { tokenAmountUsdForToken } from "./usd-pricing.ts";
import { sharedCache } from "./shared-cache.ts";

const ERC20_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

export class UserNotFoundError extends Error {
  constructor(privyUserId: string) {
    super(`No user record for Privy user ${privyUserId}.`);
    this.name = "UserNotFoundError";
  }
}

export interface UserBalance {
  symbol: TokenSymbol;
  address: `0x${string}`;
  decimals: number;
  balanceRaw: string;
  usdValue: number;
}

export interface UserPortfolio {
  address: string;
  balances: UserBalance[];
  transactions: PortfolioTransaction[];
  preferences: {
    hideSmallBalances: boolean;
    dailyCapUsd: string;
    defaultSlippageBps: string;
  } | null;
}

/**
 * Every registry token's balance for one wallet, USD-priced best-effort.
 * One RPC read per token; a failed read reports 0 rather than failing the
 * set. `getUserPortfolio` computes it fresh; the live stream reads it
 * through `readWalletBalances`'s shared cache.
 */
export async function computeWalletBalances(
  walletAddress: string,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): Promise<UserBalance[]> {
  const lower = walletAddress.toLowerCase();
  const tokens = Object.entries(getTokens(chainId)) as [TokenSymbol, Token][];
  const rpcClient = getRpcClient(chainId);
  return Promise.all(
    tokens.map(async ([symbol, t]) => {
      let raw: bigint;
      try {
        raw = t.native
          ? await rpcClient.getBalance({ address: lower as Address })
          : await rpcClient.readContract({
              address: t.address,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [lower as Address],
            });
      } catch (err) {
        logger.warn({ err, symbol, address: t.address }, "balance fetch failed; treating as 0");
        return { symbol, address: t.address, decimals: t.decimals, balanceRaw: "0", usdValue: 0 };
      }
      // Pricing is best-effort and MUST NOT zero out a real balance — a
      // missing price just means usd=0.
      let usdValue = 0;
      try {
        usdValue = await tokenAmountUsdForToken(t, raw);
      } catch (err) {
        logger.warn({ err, symbol }, "usd pricing failed; keeping balance, usd=0");
      }
      return {
        symbol,
        address: t.address,
        decimals: t.decimals,
        balanceRaw: raw.toString(),
        usdValue,
      };
    }),
  );
}

/**
 * Phase 7 / R-001 — the stream's balance read. One computation per wallet
 * per window, shared across streams and instances (the R-007 cache), and
 * invalidated by a verified fill (market-fills.ts) so a trade's balance
 * change pushes on the next tick instead of waiting out the window.
 */
export const BALANCES_CACHE_MS = 15_000;
export function balancesCacheKey(walletAddress: string, chainId: SupportedChainId): string {
  return `balances:${String(chainId)}:${walletAddress.toLowerCase()}`;
}
export function readWalletBalances(
  walletAddress: string,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): Promise<UserBalance[]> {
  return sharedCache.getOrCompute(balancesCacheKey(walletAddress, chainId), BALANCES_CACHE_MS, () =>
    computeWalletBalances(walletAddress, chainId),
  );
}

/**
 * P8-003 / P8-005 — user wallet portfolio: balances + tx history +
 * preferences. Mirrors `agent-portfolio.ts:getAgentPortfolio` but
 * keyed off the Privy wallet address from auth, and adds the user's
 * stored preferences (so the client can read `hide_small_balances`
 * without a second round-trip).
 */
export async function getUserPortfolio(
  privyUserId: string,
  walletAddress: string,
  txLimit = 50,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): Promise<UserPortfolio> {
  const lower = walletAddress.toLowerCase();
  const balances = await computeWalletBalances(lower, chainId);

  // DB lookups (tx history + prefs) degrade to empty/null if Postgres is
  // unreachable — balances come from RPC and shouldn't be hidden behind
  // an offline database.
  let transactions: PortfolioTransaction[] = [];
  let preferences: UserPortfolio["preferences"] = null;
  try {
    transactions = await db
      .select()
      .from(portfolioTransactions)
      .where(eq(portfolioTransactions.walletAddress, lower))
      .orderBy(desc(portfolioTransactions.createdAt))
      .limit(txLimit);

    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.privyUserId, privyUserId))
      .limit(1);
    const user = userRows.at(0);

    if (user) {
      const prefRows = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, user.id))
        .limit(1);
      const pref = prefRows.at(0);
      if (pref) {
        // hide_small_balances is stored as jsonb (boolean); coerce safely.
        const hide = typeof pref.hideSmallBalances === "boolean" ? pref.hideSmallBalances : true;
        preferences = {
          hideSmallBalances: hide,
          dailyCapUsd: pref.dailyCapUsd,
          defaultSlippageBps: pref.defaultSlippageBps,
        };
      }
    }
  } catch (err) {
    logger.warn({ err }, "portfolio DB lookups failed; returning balances only");
  }

  return {
    address: lower,
    balances,
    transactions,
    preferences,
  };
}
