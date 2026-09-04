import { type Address, parseUnits } from "viem";
import { AgentWalletNotFoundError, getAgentWallet } from "./agent-wallet.ts";
import { BASE_CHAIN_ID, getChainInfo, getExplorerTxUrl, type SupportedChainId } from "./chains.ts";
import {
  awaitReceipt,
  createAgentContractExecution,
  type TransactionState,
} from "./circle/execute.ts";
import {
  claimExecutionFinalization,
  recordPendingExecution,
  recordSendPortfolioTx,
} from "./circle/finalize.ts";
import { checkSpendingCap, recordSpending } from "./spending-cap.ts";
import { getToken, type TokenSymbol } from "./tokens.ts";
import { tokenAmountUsd } from "./usd-pricing.ts";

/**
 * P6-004 — send tokens from the agent wallet.
 *
 * Runs on Base via the agent's Circle Developer-Controlled Wallet:
 * an ERC-20 `transfer(to, amount)` executed and gas-sponsored by Circle. The
 * user has no signing role (per D-008 the user's Privy wallet is never touched
 * by the agent path). Spending cap is enforced via the Phase 1 rail in
 * spending-cap.ts, which keys on wallet address and treats agent wallets
 * transparently.
 *
 * C-015 — receipts, not broadcasts. The pending execution is persisted to
 * `circle_executions` before the receipt wait, and this function resolves
 * only on a CONFIRMED/COMPLETE receipt. A reverted transfer raises
 * `CircleTransactionFailedError`; a bounded timeout raises
 * `CircleReceiptTimeoutError` — a PENDING outcome the webhook finalizer
 * (`routes/circle-webhook.ts`) resolves later. The spend is recorded only
 * after confirmation, so a revert can never leave money counted as spent.
 */
function agentNetworkName(chainId: SupportedChainId): string {
  return getChainInfo(chainId).displayName.toLowerCase().replace(/\s+/g, "-");
}

export interface AgentSendArgs {
  privyUserId: string;
  to: Address;
  symbol: TokenSymbol;
  /** Decimal-string amount in human-readable units, e.g. "1.5". */
  amount: string;
  /** Execution chain — defaults to Base. */
  chainId?: SupportedChainId;
  /** Request context for the durable audit trail (optional). */
  auditContext?: { ipAddress?: string; userAgent?: string };
}

export interface AgentSendResult {
  txHash: `0x${string}`;
  amountAtomic: string;
  amountDecimal: string;
  symbol: TokenSymbol;
  to: Address;
  agentAddress: string;
  usdValue: number;
  network: string;
  explorerUrl: string;
}

export function explorerTxUrl(txHash: string, chainId: SupportedChainId = BASE_CHAIN_ID): string {
  return getExplorerTxUrl(chainId, txHash);
}

/** The confirmed receipt state — exported so callers can branch on it. */
export type SendReceiptState = TransactionState;

export async function sendFromAgentWallet(args: AgentSendArgs): Promise<AgentSendResult> {
  const { privyUserId, to, symbol, amount } = args;
  const chainId = args.chainId ?? BASE_CHAIN_ID;

  const wallet = await getAgentWallet(privyUserId, chainId);
  if (!wallet) throw new AgentWalletNotFoundError(privyUserId);

  const token = getToken(symbol, chainId);
  const amountAtomic = parseUnits(amount, token.decimals);
  if (amountAtomic <= 0n) {
    throw new Error("amount must be positive");
  }

  // USD value for the cap rail. tokenAmountUsd returns 0 if pricing is
  // unavailable, so a 0 value
  // there is fine. On mainnet, a price of 0 means we couldn't reach
  // CoinGecko — checkSpendingCap will treat that as a $0 spend, which is
  // the same fail-open behavior the existing user paths use.
  const usdValue = await tokenAmountUsd(symbol, amountAtomic);
  await checkSpendingCap(wallet.address, usdValue);

  // All app tokens (USDC/EURC/cbBTC) are read as ERC-20s, so a send is an
  // ERC-20 transfer executed by the agent's Circle wallet (gas-sponsored).
  if (token.native) {
    throw new Error(`Native ${symbol} transfers are not supported via the agent wallet yet`);
  }

  // C-015 — create the transaction (idempotency-keyed), persist the pending
  // execution BEFORE waiting, then poll to a terminal state. If this lambda
  // freezes mid-wait, the webhook finalizer still resolves the execution.
  const created = await createAgentContractExecution({
    walletId: wallet.circleWalletId,
    to: token.address,
    abiFunctionSignature: "transfer(address,uint256)",
    abiParameters: [to, amountAtomic.toString()],
  });
  await recordPendingExecution({
    circleTxId: created.id,
    kind: "agent_send",
    action: "agent_send",
    ...(wallet.userId ? { userId: wallet.userId } : {}),
    walletAddress: wallet.address,
    circleWalletId: wallet.circleWalletId,
    payload: {
      to,
      symbol,
      amountDecimal: amount,
      amountAtomic: amountAtomic.toString(),
      usdValue,
      network: agentNetworkName(chainId),
      agentAddress: wallet.address,
      ...(args.auditContext?.ipAddress ? { ipAddress: args.auditContext.ipAddress } : {}),
      ...(args.auditContext?.userAgent ? { userAgent: args.auditContext.userAgent } : {}),
    },
  });

  // Wait for the receipt — bounded. The webhook finalizer covers timeouts;
  // a failed/reverted transfer raises before a single cent is recorded.
  const receipt = await awaitReceipt(created.id);

  // C-015 — exactly-once ledger finalization: if the webhook finalizer won
  // the race, it already recorded (or reversed) the spend — do neither.
  const claim = await claimExecutionFinalization(created.id, "poll", receipt.state);
  if (claim !== "lost") {
    await recordSpending(wallet.address, usdValue);
    await recordSendPortfolioTx({
      ...(wallet.userId ? { userId: wallet.userId } : {}),
      walletAddress: wallet.address,
      action: "send",
      txHash: receipt.txHash,
      params: {
        to,
        symbol,
        amountDecimal: amount,
        amountAtomic: amountAtomic.toString(),
        network: agentNetworkName(chainId),
      },
      usdValue,
    });
  }

  return {
    txHash: receipt.txHash,
    amountAtomic: amountAtomic.toString(),
    amountDecimal: amount,
    symbol,
    to,
    agentAddress: wallet.address,
    usdValue,
    network: agentNetworkName(chainId),
    explorerUrl: explorerTxUrl(receipt.txHash, chainId),
  };
}
