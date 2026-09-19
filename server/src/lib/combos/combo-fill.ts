import type { DB } from "../../db/client.ts";
import { recordActivity } from "../activity.ts";
import { logAudit } from "../audit.ts";
import type { SupportedChainId } from "../chains.ts";
import { readComboOnChain, planComboMarket } from "./combo-market.ts";
import { oddsMultiplier } from "./combo-pricing.ts";
import { latestPricesBps, legCandidatesFrom, readLegRows, type LegRef } from "./combo-read.ts";
import { closeTicketsFifo } from "./combo-stamps.ts";
import { closeTxRecorded, openTicketsOnMarket, placeCombo } from "./combo-store.ts";

/**
 * Task 072 / CB-005, CB-008 — what a verified combo transaction writes: a
 * buy places one ticket (its legs re-read from the canonical tables and
 * checked against the market id, which is the commitment over exactly
 * those legs), a sell closes the caller's tickets on that market oldest
 * first. Both write the timeline and the audit log; both are idempotent
 * on the transaction hash (the buy through the unique index, the sell
 * through the close stamp). The amounts come from the receipt, never
 * from a client (`combo-receipt.ts`).
 */

export interface VerifiedComboFill {
  userId: string;
  walletAddress: string;
  chainId: SupportedChainId;
  marketId: `0x${string}`;
  direction: "buy" | "sell";
  /** YES shares bought or sold, raw — from the receipt. */
  tokensRaw: bigint;
  /** USDC paid (buy) or received (sell), raw — from the receipt. */
  usdcRaw: bigint;
  txHash: string;
  legs: readonly LegRef[];
  source: "user" | "agent";
  mode: string | null;
}

export class ComboLegMismatchError extends Error {
  constructor() {
    super("The legs do not name this combo market");
    this.name = "ComboLegMismatchError";
  }
}

export type ComboFillOutcome =
  | { kind: "placed"; comboId: string }
  | { kind: "closed"; comboIds: string[] }
  | { kind: "replayed" };

async function recordSell(db: DB, fill: VerifiedComboFill): Promise<ComboFillOutcome> {
  if (await closeTxRecorded(db, fill.txHash)) return { kind: "replayed" };
  const tickets = await openTicketsOnMarket(db, fill.userId, fill.marketId);
  const closed = await closeTicketsFifo(db, tickets, fill.tokensRaw, fill.usdcRaw, fill.txHash);
  await recordActivity(db, {
    kind: "combo_close",
    actor: fill.source === "agent" ? "agent" : "user",
    userId: fill.userId,
    walletAddress: fill.walletAddress,
    txHash: fill.txHash,
    chainId: fill.chainId,
    marketId: fill.marketId,
    asset: "combo",
    amountRaw: fill.tokensRaw.toString(),
    valueUsd: Number(fill.usdcRaw) / 1e6,
    positionRef: closed[0] ?? null,
    data: { closed, soldRaw: fill.tokensRaw.toString() },
  });
  await logAudit({
    walletAddress: fill.walletAddress,
    action: "combo_close",
    outcome: "success",
    txHash: fill.txHash,
    chainId: fill.chainId,
    params: {
      marketId: fill.marketId,
      closed,
      soldRaw: fill.tokensRaw.toString(),
      mode: fill.mode,
    },
  });
  return { kind: "closed", comboIds: closed };
}

export async function recordComboFill(db: DB, fill: VerifiedComboFill): Promise<ComboFillOutcome> {
  if (fill.direction === "sell") return recordSell(db, fill);
  const rows = await readLegRows(db, fill.legs, fill.chainId);
  const prices = await latestPricesBps(
    db,
    rows.map((r) => r.marketId),
  );
  const candidates = legCandidatesFrom(rows, prices, () => false);
  const plan = candidates.length >= 2 ? planComboMarket(candidates, fill.chainId) : null;
  if (!plan || plan.marketId.toLowerCase() !== fill.marketId.toLowerCase()) {
    throw new ComboLegMismatchError();
  }
  const onChain = await readComboOnChain(fill.marketId, fill.chainId);
  if (!onChain) throw new ComboLegMismatchError();
  const entryPriceBps = fill.tokensRaw > 0n ? Number((fill.usdcRaw * 10_000n) / fill.tokensRaw) : 0;
  const comboId = await placeCombo(db, {
    userId: fill.userId,
    walletAddress: fill.walletAddress,
    chainId: fill.chainId,
    marketId: fill.marketId,
    marketAddress: onChain.marketAddress,
    yesToken: onChain.yesToken,
    poolId: onChain.poolId,
    label: plan.label,
    startsAt: new Date(plan.startsAt * 1000),
    openingProbability: plan.openingProbability,
    stakeRaw: fill.usdcRaw,
    sharesRaw: fill.tokensRaw,
    entryPriceBps,
    combinedOdds: oddsMultiplier(entryPriceBps),
    txHash: fill.txHash,
    source: fill.source,
    mode: fill.mode,
    legs: candidates.map((c) => ({
      marketId: c.marketId,
      providerEventId: c.providerEventId,
      outcomeIndex: c.outcomeIndex,
      label: c.teamName,
      opponent: c.opponentName,
      league: c.league,
      kickoffAt: new Date(c.kickoffAt * 1000),
      entryPrice: (c.priceBps ?? 0) / 10_000,
    })),
  });
  if (!comboId) return { kind: "replayed" };
  await recordActivity(db, {
    kind: "combo_open",
    actor: fill.source === "agent" ? "agent" : "user",
    userId: fill.userId,
    walletAddress: fill.walletAddress,
    txHash: fill.txHash,
    chainId: fill.chainId,
    marketId: fill.marketId,
    positionRef: comboId,
    asset: plan.label,
    amountRaw: fill.tokensRaw.toString(),
    valueUsd: Number(fill.usdcRaw) / 1e6,
    data: { legs: candidates.length, entryPriceBps, mode: fill.mode },
  });
  await logAudit({
    walletAddress: fill.walletAddress,
    action: "combo_open",
    outcome: "success",
    txHash: fill.txHash,
    chainId: fill.chainId,
    params: {
      comboId,
      marketId: fill.marketId,
      legs: candidates.map((c) => c.marketId),
      stakeRaw: fill.usdcRaw.toString(),
      mode: fill.mode,
    },
  });
  return { kind: "placed", comboId };
}
