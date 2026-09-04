/**
 * Market trades signed by a Circle agent wallet — the execute leg shared by
 * the hedging-strategy executor (B9-005) and the agent's trade tool
 * (B8-005). Uses the same `buildMarketTrade` the user's button uses, then
 * approves and swaps through the Circle execution choke points, which
 * enforce the contract allowlist (per-market tokens are registered from OUR
 * database rows immediately before executing — never from user input).
 *
 * C-015 — the swap leg resolves ONLY on a confirmed receipt. When the
 * caller passes `ledger`, the swap's pending execution is persisted to
 * `circle_executions` before the receipt wait, so a frozen lambda is still
 * finalized by the webhook finalizer (`routes/circle-webhook.ts`) — a
 * strategy close can never be lost to a poll timeout.
 */

import {
  awaitReceipt,
  createAgentContractExecution,
  executeAgentAbiCall,
} from "../circle/execute.ts";
import {
  claimExecutionFinalization,
  recordPendingExecution,
  type ExecutionKind,
} from "../circle/finalize.ts";
import { registerDynamicTargets } from "../circle/allowed-targets.ts";
import type { SupportedChainId } from "../chains.ts";
import { buildMarketTrade } from "./market-trade-build.ts";

export interface AgentTradeResult {
  txHash: `0x${string}`;
  /** Circle transaction id of the swap leg (for finalization claims). */
  circleTxId: string;
  /** Who owns the outcome record: this poll, or the webhook finalizer that
   * already finalized the execution while the receipt was still pending. */
  finalizedBy: "poll" | "webhook";
  marketId: `0x${string}`;
  quote: { amountIn: string; amountOut: string; effectivePriceBps: number | null };
}

/** Optional durable-ledger binding for the swap leg (C-015). */
export interface AgentTradeLedger {
  kind: ExecutionKind;
  userId?: string;
  walletAddress?: string;
  circleWalletId?: string;
  /** Caller context merged into the pending payload (strategy id, action, …). */
  payload: Record<string, unknown>;
}

export async function agentMarketTrade(args: {
  walletId: string;
  providerEventId: string;
  outcomeIndex: 0 | 1;
  direction: "buy" | "sell";
  amountRaw: bigint;
  chainId?: SupportedChainId;
  /** Record the swap as a pending execution before the receipt wait. */
  ledger?: AgentTradeLedger;
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

  // Swap leg — create (idempotency-keyed), optionally persist the pending
  // execution, then wait for the receipt. expectedOut is the quote at build
  // time; the webhook finalizer treats it as the close's expected proceeds.
  const created = await createAgentContractExecution({
    walletId: args.walletId,
    to: built.to,
    callData: built.data,
  });
  if (args.ledger) {
    await recordPendingExecution({
      circleTxId: created.id,
      kind: args.ledger.kind,
      action: "strategy_close",
      ...(args.ledger.userId ? { userId: args.ledger.userId } : {}),
      ...(args.ledger.walletAddress ? { walletAddress: args.ledger.walletAddress } : {}),
      ...(args.ledger.circleWalletId ? { circleWalletId: args.ledger.circleWalletId } : {}),
      payload: {
        ...args.ledger.payload,
        soldRaw: args.amountRaw.toString(),
        usdcOutRaw: built.quote.amountOut,
      },
    });
  }
  const receipt = await awaitReceipt(created.id);

  // C-015 — exactly-once finalization: the webhook finalizer may have
  // resolved this execution while the poll was still waiting. "lost" means
  // the webhook won; the caller must not close or audit a second time.
  let finalizedBy: "poll" | "webhook" = "poll";
  if (args.ledger) {
    const claim = await claimExecutionFinalization(created.id, "poll", receipt.state);
    if (claim === "lost") finalizedBy = "webhook";
  }

  return {
    txHash: receipt.txHash,
    circleTxId: created.id,
    finalizedBy,
    marketId: built.marketId,
    quote: built.quote,
  };
}
