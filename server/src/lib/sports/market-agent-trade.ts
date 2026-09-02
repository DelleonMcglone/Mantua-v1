/**
 * Market trades signed by a Circle agent wallet — the execute leg shared by
 * the hedging-strategy executor (B9-005) and the agent's trade tool
 * (B8-005). Uses the same `buildMarketTrade` the user's button uses, then
 * approves and swaps through the Circle execution choke points, which
 * enforce the contract allowlist (per-market tokens are registered from OUR
 * database rows immediately before executing — never from user input).
 */

import { executeAgentAbiCall, executeAgentCalldata } from "../circle/execute.ts";
import { registerDynamicTargets } from "../circle/allowed-targets.ts";
import type { SupportedChainId } from "../chains.ts";
import { buildMarketTrade } from "./market-trade-build.ts";

export interface AgentTradeResult {
  txHash: `0x${string}`;
  marketId: `0x${string}`;
  quote: { amountIn: string; amountOut: string; effectivePriceBps: number | null };
}

export async function agentMarketTrade(args: {
  walletId: string;
  providerEventId: string;
  outcomeIndex: 0 | 1;
  direction: "buy" | "sell";
  amountRaw: bigint;
  chainId?: SupportedChainId;
}): Promise<AgentTradeResult> {
  const built = await buildMarketTrade({
    providerEventId: args.providerEventId,
    outcomeIndex: args.outcomeIndex,
    direction: args.direction,
    amountRaw: args.amountRaw,
    ...(args.chainId !== undefined ? { chainId: args.chainId } : {}),
  });

  // The YES token and market address come from the factory via our own
  // reads — server-trusted, safe to admit for this invocation.
  registerDynamicTargets([built.inputToken, built.yesToken, built.marketAddress]);

  if (built.approvalTarget) {
    await executeAgentAbiCall({
      walletId: args.walletId,
      to: built.inputToken,
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [built.approvalTarget, built.quote.amountIn],
    });
  }
  const { txHash } = await executeAgentCalldata({
    walletId: args.walletId,
    to: built.to,
    callData: built.data,
  });
  return { txHash, marketId: built.marketId, quote: built.quote };
}
