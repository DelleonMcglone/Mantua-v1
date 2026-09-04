import { eq } from "drizzle-orm";
import { parseUnits } from "viem";
import { db } from "../db/client.ts";
import { portfolioTransactions } from "../db/schema/trading.ts";
import { users } from "../db/schema/users.ts";
import { explorerTxUrl } from "./agent-send.ts";
import { AgentWalletNotFoundError, getAgentWallet } from "./agent-wallet.ts";
import { executeAgentAbiCall, executeAgentCalldata } from "./circle/execute.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { checkSpendingCap, recordSpending } from "./spending-cap.ts";
import { getToken, type TokenSymbol } from "./tokens.ts";
import { tokenAmountUsdStrict } from "./usd-pricing.ts";
import { buildPoolSwapTestCalldata, quoteExactInputV4 } from "./v4-onchain-swap.ts";
import type { FeeTier } from "./v4-contracts.ts";

/**
 * Execute a swap from the agent wallet on Base via its Circle
 * Developer-Controlled Wallet.
 *
 * Agent swaps run against the no-hook pool for the pair (the Stable Protection
 * hook's circuit breaker blocks USDC/EURC, so no-hook is the reliable agent
 * path). The on-chain v4 quote auto-resolves whichever fee tier the pool was
 * actually created at. Two gas-sponsored Circle txs: approve the input ERC-20
 * to the swap router, then execute the swap calldata.
 */
const AGENT_NETWORK = "base";

// No-hook pools: the quoter auto-resolves to the tier the pool was created at,
// so this is just the starting probe.
const DEFAULT_PROBE_FEE: FeeTier = 3000;

export interface AgentSwapArgs {
  privyUserId: string;
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  /** Decimal-string amount in the human-readable units of `tokenIn`. */
  amountIn: string;
  /** Execution chain — defaults to Base. */
  chainId?: SupportedChainId;
}

export interface AgentSwapResult {
  txHash: `0x${string}`;
  explorerUrl: string;
  agentAddress: string;
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  amountInRaw: string;
  amountOutRaw: string;
  usdValue: number;
  network: string;
}

export interface AgentSwapQuote {
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  amountInRaw: string;
  amountOutRaw: string;
}

/**
 * Live no-hook quote for the agent UI — what the agent would receive
 * swapping `amountIn` of `tokenIn` for `tokenOut`. Read-only (no wallet,
 * no execution); mirrors the quote `swapFromAgentWallet` runs at execution
 * so the form estimate matches the eventual fill closely.
 */
export async function quoteAgentSwap(args: {
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  amountIn: string;
  chainId?: SupportedChainId;
}): Promise<AgentSwapQuote> {
  const { tokenIn, tokenOut, amountIn } = args;
  const chainId = args.chainId ?? BASE_CHAIN_ID;
  if (tokenIn === tokenOut) throw new Error("tokenIn and tokenOut must differ");
  const amountAtomic = parseUnits(amountIn, getToken(tokenIn, chainId).decimals);
  if (amountAtomic <= 0n) throw new Error("amountIn must be positive");
  const quote = await quoteExactInputV4({
    tokenIn,
    tokenOut,
    fee: DEFAULT_PROBE_FEE,
    hook: null,
    amountInRaw: amountAtomic,
    chainId,
  });
  return {
    tokenIn,
    tokenOut,
    amountInRaw: amountAtomic.toString(),
    amountOutRaw: quote.amountOut,
  };
}

export async function swapFromAgentWallet(args: AgentSwapArgs): Promise<AgentSwapResult> {
  const { privyUserId, tokenIn, tokenOut, amountIn } = args;
  const chainId = args.chainId ?? BASE_CHAIN_ID;
  if (tokenIn === tokenOut) throw new Error("tokenIn and tokenOut must differ");

  const wallet = await getAgentWallet(privyUserId, chainId);
  if (!wallet) throw new AgentWalletNotFoundError(privyUserId);

  const inDef = getToken(tokenIn, chainId);
  const amountAtomic = parseUnits(amountIn, inDef.decimals);
  if (amountAtomic <= 0n) throw new Error("amountIn must be positive");

  // C-019 — strict pricing: a dead feed throws instead of valuing the spend
  // at $0, so the cap cannot be priced around.
  const usdValue = await tokenAmountUsdStrict(tokenIn, amountAtomic);
  await checkSpendingCap(wallet.address, usdValue);

  // Quote the no-hook pool on the execution chain; the tier is
  // auto-resolved to the live pool.
  const quote = await quoteExactInputV4({
    tokenIn,
    tokenOut,
    fee: DEFAULT_PROBE_FEE,
    hook: null,
    amountInRaw: amountAtomic,
    chainId,
  });
  const swap = buildPoolSwapTestCalldata({
    poolKey: quote.poolKey,
    zeroForOne: quote.zeroForOne,
    amountInRaw: amountAtomic,
    chainId,
  });

  // Approve the input ERC-20 to the swap router, then execute the swap. Native
  // input has no approvalTarget (value is carried on the call instead).
  if (swap.approvalTarget && !inDef.native) {
    await executeAgentAbiCall({
      walletId: wallet.circleWalletId,
      to: inDef.address,
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [swap.approvalTarget, amountAtomic.toString()],
    });
  }

  const { txHash } = await executeAgentCalldata({
    walletId: wallet.circleWalletId,
    to: swap.to,
    callData: swap.data,
    ...(swap.value !== "0" ? { value: swap.value } : {}),
  });

  await recordSpending(wallet.address, usdValue);

  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const user = userRows.at(0);
  if (user) {
    await db.insert(portfolioTransactions).values({
      userId: user.id,
      walletAddress: wallet.address,
      action: "swap",
      txHash,
      chainId,
      params: {
        tokenIn,
        tokenOut,
        amountInRaw: amountAtomic.toString(),
        amountOutRaw: quote.amountOut,
        agent: true,
      },
      outcome: "success",
      usdValue: usdValue > 0 ? usdValue.toFixed(2) : null,
    });
  }

  return {
    txHash,
    explorerUrl: explorerTxUrl(txHash, chainId),
    agentAddress: wallet.address,
    tokenIn,
    tokenOut,
    amountInRaw: amountAtomic.toString(),
    amountOutRaw: quote.amountOut,
    usdValue,
    network: AGENT_NETWORK,
  };
}
