import { type Address, parseUnits } from "viem";
import { AgentWalletNotFoundError, getAgentWallet } from "./agent-wallet.ts";
import {
  BASE_CHAIN_ID,
  getChainInfo,
  getExplorerTxUrl,
  type SupportedChainId,
} from "./chains.ts";
import { executeAgentAbiCall } from "./circle/execute.ts";
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

export function explorerTxUrl(
  txHash: string,
  chainId: SupportedChainId = BASE_CHAIN_ID,
): string {
  return getExplorerTxUrl(chainId, txHash);
}

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
  const { txHash } = await executeAgentAbiCall({
    walletId: wallet.circleWalletId,
    to: token.address,
    abiFunctionSignature: "transfer(address,uint256)",
    abiParameters: [to, amountAtomic.toString()],
  });

  await recordSpending(wallet.address, usdValue);

  return {
    txHash,
    amountAtomic: amountAtomic.toString(),
    amountDecimal: amount,
    symbol,
    to,
    agentAddress: wallet.address,
    usdValue,
    network: agentNetworkName(chainId),
    explorerUrl: explorerTxUrl(txHash, chainId),
  };
}
