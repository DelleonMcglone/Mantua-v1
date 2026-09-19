import { z } from "zod";
import type { DB } from "../../db/client.ts";
import { readPolicy } from "../agent/policy.ts";
import type { SupportedChainId } from "../chains.ts";
import { checkSpendingCap, recordSpending } from "../spending-cap.ts";
import { agentComboTrade } from "./combo-agent-trade.ts";
import { readEdgeCandidates } from "./combo-agent-read.ts";
import { proposeCombo } from "./combo-agent.ts";
import { recordComboFill } from "./combo-fill.ts";
import { prepareComboMarket, type PrepareResult } from "./combo-prepare.ts";
import { platformLimits, quoteComboTicket } from "./combo-quote.ts";
import type { ComboQuoteResult } from "./combo-quote-types.ts";
import { readLegRows, winnersByMarket, type LegRef } from "./combo-read.ts";
import { playoffsLookup } from "./combo-season.ts";
import { openExposureUsd } from "./combo-store.ts";
import { legResults } from "./combo-trade.ts";

/**
 * Task 072 / CB-006 — the agent's combo tools, as functions the chat
 * executor calls. `buildComboPreview` proposes (from edge and policy) or
 * quotes the legs the user named; `executeComboBuy` runs after the gate
 * has consumed the confirmation and re-checked drift: ensure the market,
 * cap-check the stake once, swap from the agent wallet, record the ticket.
 */

export const comboToolLegsSchema = z
  .array(
    z.object({
      providerEventId: z.string().regex(/^\d{1,32}$/),
      outcomeIndex: z.union([z.literal(0), z.literal(1)]),
    }),
  )
  .min(2)
  .max(8);

export const buildComboInputSchema = z.object({
  stakeUsd: z.number().positive().max(10_000).optional(),
  legs: comboToolLegsSchema.optional(),
});

export const executeComboInputSchema = z.object({
  marketId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  legs: comboToolLegsSchema,
  stakeUsd: z.number().positive().max(10_000),
});
export type ExecuteComboInput = z.infer<typeof executeComboInputSchema>;

/** The execution's canonical arguments — what the preview hashes and the call must repeat. */
export function comboExecutionArgs(
  marketId: string,
  legs: readonly LegRef[],
  stakeUsd: number,
): ExecuteComboInput {
  return { marketId: marketId.toLowerCase(), legs: legs.map((l) => ({ ...l })), stakeUsd };
}

export async function quoteForAgent(
  db: DB,
  userId: string,
  legs: readonly LegRef[],
  stakeUsd: number,
  chainId: SupportedChainId,
): Promise<ComboQuoteResult> {
  return quoteComboTicket(db, {
    userId,
    legs,
    stakeRaw: BigInt(Math.round(stakeUsd * 1e6)),
    chainId,
    policy: await readPolicy(db, userId),
    playoffsOf: await playoffsLookup(),
  });
}

export interface ComboPreviewResult {
  quote: ComboQuoteResult;
  legs: LegRef[];
  stakeUsd: number;
  rationale: string[];
}

/** Propose from the slate when no legs are named; otherwise quote the named legs. */
export async function buildComboPreview(
  db: DB,
  userId: string,
  input: z.infer<typeof buildComboInputSchema>,
  chainId: SupportedChainId,
  nowSeconds: number,
): Promise<ComboPreviewResult | { refused: string[] }> {
  const policy = await readPolicy(db, userId);
  let legs = input.legs ?? [];
  let stakeUsd = input.stakeUsd ?? 0;
  let rationale: string[] = [];
  if (legs.length === 0) {
    const proposal = proposeCombo({
      candidates: await readEdgeCandidates(db, nowSeconds),
      policy: {
        ...policy,
        riskLevel: policy.riskLevel,
        maxStakePerTradeUsd: policy.maxStakePerTradeUsd,
      },
      platform: platformLimits(),
      openExposureUsd: await openExposureUsd(db, userId),
      nowSeconds,
    });
    if (!proposal.ok) return { refused: proposal.reasons };
    legs = proposal.legs.map((p) => ({
      providerEventId: p.leg.providerEventId,
      outcomeIndex: p.leg.outcomeIndex,
    }));
    stakeUsd = input.stakeUsd ?? proposal.stakeUsd;
    rationale = proposal.rationale;
  }
  if (stakeUsd <= 0) return { refused: ["a stake is required when the legs are named"] };
  return {
    quote: await quoteForAgent(db, userId, legs, stakeUsd, chainId),
    legs,
    stakeUsd,
    rationale,
  };
}

export interface ExecuteComboDeps {
  wallet: { circleWalletId: string; address: string };
  chainId: SupportedChainId;
  mode: string;
  nowMs: number;
  trade?: typeof agentComboTrade;
}

function prepareFailure(p: Exclude<PrepareResult, { kind: "ready" }>): string {
  switch (p.kind) {
    case "refused":
      return `These legs cannot be combined: ${p.violations.map((v) => v.detail).join("; ")}`;
    case "disabled":
      return "Combos are switched off in the policy.";
    case "no_market":
      return "A leg has no market yet.";
    case "capacity":
      return "No capacity for a new combo market right now.";
    case "no_signer":
      return "Combo markets cannot be created on this deployment.";
    case "failed":
      return p.error;
  }
}

/** After the gate: prepare the market, one cap check, swap, record the ticket. */
export async function executeComboBuy(
  db: DB,
  userId: string,
  input: ExecuteComboInput,
  deps: ExecuteComboDeps,
): Promise<{ txHash: string; comboId: string | null; sharesRaw: string; marketId: string }> {
  const prepared = await prepareComboMarket(db, {
    userId,
    walletAddress: deps.wallet.address,
    legs: input.legs,
    chainId: deps.chainId,
    policy: await readPolicy(db, userId),
    nowSeconds: Math.floor(deps.nowMs / 1000),
  });
  if (prepared.kind !== "ready") throw new Error(prepareFailure(prepared));
  const { plan, onChain } = prepared;
  if (plan.marketId.toLowerCase() !== input.marketId.toLowerCase()) {
    throw new Error("The legs do not name this combo market.");
  }
  const rows = await readLegRows(db, input.legs, deps.chainId);
  const amountRaw = BigInt(Math.round(input.stakeUsd * 1e6));
  await checkSpendingCap(deps.wallet.address, input.stakeUsd);
  const legs = legResults(
    rows,
    await winnersByMarket(
      db,
      rows.map((r) => r.marketId),
    ),
  );
  const result = await (deps.trade ?? agentComboTrade)({
    walletId: deps.wallet.circleWalletId,
    walletAddress: deps.wallet.address,
    userId,
    comboId: null,
    legs: input.legs,
    trade: {
      marketId: plan.marketId,
      onChain,
      direction: "buy",
      amountRaw,
      chainId: deps.chainId,
      legs,
      nowMs: deps.nowMs,
    },
  });
  // C-015 — the webhook finalizer may already have recorded the spend and
  // the ticket while this call waited on the receipt; only the claim winner writes.
  if (result.finalizedBy === "webhook") {
    return {
      txHash: result.txHash,
      comboId: null,
      sharesRaw: result.quote.amountOut,
      marketId: plan.marketId,
    };
  }
  await recordSpending(deps.wallet.address, input.stakeUsd);
  const fill = await recordComboFill(db, {
    userId,
    walletAddress: deps.wallet.address,
    chainId: deps.chainId,
    marketId: plan.marketId,
    direction: "buy",
    tokensRaw: BigInt(result.quote.amountOut),
    usdcRaw: amountRaw,
    txHash: result.txHash,
    legs: input.legs,
    source: "agent",
    mode: deps.mode,
  });
  return {
    txHash: result.txHash,
    comboId: fill.kind === "placed" ? fill.comboId : null,
    sharesRaw: result.quote.amountOut,
    marketId: plan.marketId,
  };
}
