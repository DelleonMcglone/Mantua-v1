import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { agentWallets } from "../../db/schema/index.ts";
import { circleBlockchainFor } from "../agent-wallet.ts";
import type { SupportedChainId } from "../chains.ts";
import { registerDynamicTargets } from "../circle/allowed-targets.ts";
import {
  awaitReceipt,
  createAgentContractExecution,
  executeAgentAbiCall,
} from "../circle/execute.ts";
import { claimExecutionFinalization, recordPendingExecution } from "../circle/finalize.ts";
import type { LegRef } from "./combo-read.ts";
import { buildComboTrade, type ComboTradeArgs } from "./combo-trade.ts";

/**
 * Task 072 / CB-006, CB-009 — a combo swap signed by the user's Circle
 * agent wallet: the same `buildComboTrade` the user's ticket uses, then
 * approve + swap through the Circle execution choke points (contract
 * allowlist fed from our own factory reads). The swap is persisted as a
 * pending `combo_trade` execution before the receipt wait (C-015) with
 * everything the webhook finalizer needs to record the ticket or the
 * close itself; the poll and the webhook race for the one finalization
 * claim, so a frozen tick never loses the trade and nothing records twice.
 */

export interface ComboExecutionPayload {
  comboId: string | null;
  userId: string;
  marketId: string;
  direction: "buy" | "sell";
  amountRaw: string;
  expectedOutRaw: string;
  agentAddress: string;
  /** Buys: the legs the fill records; hedges/sells omit them. */
  legs?: LegRef[];
  /** Hedge of one leg in its own market — never a ticket. */
  hedge?: boolean;
}

export interface AgentComboTradeResult {
  txHash: `0x${string}`;
  circleTxId: string;
  /** Who records the ticket / close: this call, or the webhook finalizer that already did. */
  finalizedBy: "poll" | "webhook";
  marketId: `0x${string}`;
  quote: { amountIn: string; amountOut: string; effectivePriceBps: number | null };
}

export async function agentComboTrade(args: {
  walletId: string;
  walletAddress: string;
  userId: string;
  comboId: string | null;
  legs?: readonly LegRef[];
  trade: ComboTradeArgs;
}): Promise<AgentComboTradeResult> {
  const built = await buildComboTrade(args.trade);
  registerDynamicTargets([built.inputToken, built.yesToken, built.marketAddress]);
  if (built.approvalTarget) {
    await executeAgentAbiCall({
      walletId: args.walletId,
      to: built.inputToken,
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [built.approvalTarget, built.quote.amountIn],
    });
  }
  const created = await createAgentContractExecution({
    walletId: args.walletId,
    to: built.to,
    callData: built.data,
  });
  const payload: ComboExecutionPayload = {
    comboId: args.comboId,
    userId: args.userId,
    marketId: built.marketId,
    direction: args.trade.direction,
    amountRaw: args.trade.amountRaw.toString(),
    expectedOutRaw: built.quote.amountOut,
    agentAddress: args.walletAddress,
    ...(args.legs ? { legs: args.legs.map((l) => ({ ...l })) } : {}),
  };
  await recordPendingExecution({
    circleTxId: created.id,
    kind: "combo_trade",
    action: args.trade.direction === "buy" ? "combo_open" : "combo_close",
    userId: args.userId,
    walletAddress: args.walletAddress,
    payload,
  });
  const receipt = await awaitReceipt(created.id);
  const claim = await claimExecutionFinalization(created.id, "poll", receipt.state);
  return {
    txHash: receipt.txHash,
    circleTxId: created.id,
    finalizedBy: claim === "lost" ? "webhook" : "poll",
    marketId: built.marketId,
    quote: built.quote,
  };
}

/** The user's agent wallet on this chain, by users.id (the monitor has no Privy id). */
export async function agentWalletForUser(
  db: DB,
  userId: string,
  chainId: SupportedChainId,
): Promise<{ circleWalletId: string; address: string } | null> {
  const row = (
    await db
      .select({ circleWalletId: agentWallets.circleWalletId, address: agentWallets.address })
      .from(agentWallets)
      .where(
        and(
          eq(agentWallets.userId, userId),
          eq(agentWallets.blockchain, circleBlockchainFor(chainId)),
        ),
      )
      .limit(1)
  ).at(0);
  return row ?? null;
}
