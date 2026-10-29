/**
 * Finalization for `kind: "agent_trade"` — a market trade the agent placed
 * from chat (owner, 2026-10-29).
 *
 * Until now the chat path recorded nothing before the receipt wait, so a
 * poll timeout left a trade the webhook finalizer could not resolve: no
 * spend, no timeline entry, no forecast row, and a retry could fill twice.
 * The swap is now persisted pending at Circle-create time with this
 * payload, and whichever path wins the finalization claim applies exactly
 * one set of effects:
 *
 *   confirmed buy  → record_spend + agent_trade_fill (timeline + forecast) + audit
 *   confirmed sell → agent_trade_fill + audit
 *   failed         → audit only (a reverted trade spent nothing)
 */

import { z } from "zod";
import type { DB } from "../../db/client.ts";
import { recordActivity } from "../activity.ts";
import { ARC_CHAIN_ID } from "../chains.ts";
import type { FinalizationEffect, FinalizationInput, FinalizationPlan } from "./finalize.ts";

export const agentTradePayloadSchema = z.object({
  agentAddress: z.string(),
  providerEventId: z.string(),
  outcomeIndex: z.union([z.literal(0), z.literal(1)]),
  direction: z.enum(["buy", "sell"]),
  /** USDC in (buy) or YES tokens in (sell), 6 decimals. */
  amountRaw: z.string(),
  /** Quoted YES out (buy) or USDC out (sell) at build time. */
  expectedOutRaw: z.string().optional(),
  marketId: z.string().optional(),
  chainId: z.number().optional(),
  confirmationId: z.string().nullable().optional(),
});
export type AgentTradePayload = z.infer<typeof agentTradePayloadSchema>;

function usdValue(p: AgentTradePayload): number {
  const raw = p.direction === "buy" ? p.amountRaw : (p.expectedOutRaw ?? "0");
  return Number(raw) / 1e6;
}

/** The plan for one agent_trade execution, or null for a payload this
 *  builder cannot honor. `outcome` is decided by the caller from the state. */
export function agentTradePlan(
  input: FinalizationInput,
  outcome: "confirmed" | "failed",
  reason?: string,
): FinalizationPlan | null {
  const parsed = agentTradePayloadSchema.safeParse(input.payload);
  if (!parsed.success) return null;
  const p = parsed.data;
  const effects: FinalizationEffect[] = [];
  if (outcome === "confirmed") {
    if (p.direction === "buy") {
      effects.push({ type: "record_spend", walletAddress: p.agentAddress, usdValue: usdValue(p) });
    }
    if (input.txHash) {
      effects.push({
        type: "agent_trade_fill",
        payload: p,
        txHash: input.txHash,
        userId: input.userId ?? null,
      });
    }
  }
  effects.push({
    type: "audit",
    entry: {
      action: "agent_market_trade",
      outcome: outcome === "confirmed" ? "success" : "failure",
      txHash: input.txHash ?? undefined,
      walletAddress: p.agentAddress,
      ...(reason ? { reason } : {}),
      params: {
        ...p,
        circleTxId: input.circleTxId,
        finalizeSource: input.source,
        finalState: input.state,
      },
    },
  });
  return { outcome, source: input.source, effects };
}

/**
 * The fill's side effects, written by whichever path finalizes: the
 * timeline entry and the forecast-ledger row for the view the buy acted on.
 * Both are best-effort and idempotent on the tx hash.
 */
export async function recordAgentTradeFill(
  db: DB,
  p: AgentTradePayload,
  txHash: string,
  userId: string | null,
  source: "poll" | "webhook",
  sessionId: string | null = null,
): Promise<void> {
  const chainId = p.chainId ?? ARC_CHAIN_ID;
  await recordActivity(db, {
    kind: p.direction === "buy" ? "market_buy" : "market_sell",
    actor: "agent",
    userId,
    walletAddress: p.agentAddress,
    txHash,
    chainId,
    marketId: p.marketId ?? null,
    asset: "YES",
    amountRaw: p.direction === "buy" ? (p.expectedOutRaw ?? null) : p.amountRaw,
    valueUsd: usdValue(p),
    data: {
      direction: p.direction,
      providerEventId: p.providerEventId,
      outcomeIndex: p.outcomeIndex,
      confirmationId: p.confirmationId ?? null,
      finalizeSource: source,
    },
  });
  if (p.direction !== "buy") return;
  // Loaded late: agent-chat is the model surface and must not be a static
  // dependency of the finalizer.
  const [{ analyzeMarket, makeSportsToolsDb }, { makeForecastSink }, { forecastModelVersion }] =
    await Promise.all([
      import("../sports/agent-sports-tools.ts"),
      import("../forecast/forecast-sink.ts"),
      import("../agent-chat.ts"),
    ]);
  await analyzeMarket(
    makeSportsToolsDb(db),
    { providerEventId: p.providerEventId, outcomeIndex: p.outcomeIndex },
    new Date(),
    makeForecastSink(db, {
      userId,
      sessionId,
      source: "proposal",
      action: "filled",
      tradeId: txHash,
      modelVersion: forecastModelVersion(),
      toolName: "mantua_execute_trade",
    }),
  );
}
