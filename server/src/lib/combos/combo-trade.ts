import { BASE_CHAIN_ID, type SupportedChainId } from "../chains.ts";
import { DEFAULT_SLIPPAGE_BPS } from "../constants.ts";
import { MIN_RATE_PIPS } from "../sports/market-fee.ts";
import {
  MarketClosedError,
  MarketDataOutageError,
  NoMarketError,
  assessMarketTradability,
  buildMarketSwap,
  type BuiltMarketTrade,
} from "../sports/market-trade-build.ts";
import { assertSlippageBounds } from "../slippage.ts";
import { readComboOnChain, type ComboOnChain } from "./combo-market.ts";
import type { ComboPricing } from "./combo-pricing.ts";
import { legGateRow, type LegRow } from "./combo-read.ts";
import { comboOutcome, legResultFrom } from "./combo-settlement.ts";
import type { LegResult } from "./combo-settlement.ts";

/**
 * Task 072 / CB-005 — one swap on the combo pool, through the same
 * `buildMarketSwap` every game trade encodes with. The gate before it is
 * the combo's: the conjunction market must be OPEN, a buy is refused once
 * the combo is dead (a leg lost) and while any in-play leg's feed is dark
 * (P-012); a sell — an exit — always builds while the market is open.
 */

export interface ComboTradeArgs {
  marketId: `0x${string}`;
  /** A chain view already read this request (the quote path), to skip a re-read. */
  onChain?: ComboOnChain | null;
  direction: "buy" | "sell";
  amountRaw: bigint;
  chainId?: SupportedChainId;
  slippageBps?: number;
  /** The legs' rows (for the feed gate) and results (for the dead check). */
  legs: readonly { row: LegRow; result: LegResult }[];
  nowMs?: number;
}

export class ComboDeadError extends Error {
  constructor(marketId: string) {
    super(`Combo ${marketId} cannot pay — a leg has already lost. Selling is still possible.`);
    this.name = "ComboDeadError";
  }
}

/** The gate, pure over the on-chain state and the legs. Throws the trade errors. */
export function assertComboTradable(
  marketId: `0x${string}`,
  onChain: ComboOnChain | null,
  args: Pick<ComboTradeArgs, "direction" | "legs">,
  nowMs: number,
): ComboOnChain {
  if (!onChain) throw new NoMarketError(`combo ${marketId}`);
  if (onChain.state !== "OPEN") {
    throw new MarketClosedError(
      `combo ${marketId}`,
      `the market is ${onChain.state.toLowerCase()}`,
    );
  }
  if (args.direction === "buy") {
    const verdict = comboOutcome(args.legs.map((l) => l.result));
    if (verdict.kind !== "pending" && verdict.kind !== "won") throw new ComboDeadError(marketId);
    for (const { row } of args.legs) {
      if (row.marketState !== "OPEN") continue; // a decided leg needs no feed
      const v = assessMarketTradability(legGateRow(row), "buy", nowMs);
      if (v.kind === "halted") throw new MarketDataOutageError(row.providerEventId, v.reason);
    }
  }
  return onChain;
}

/** Quote + encode one combo swap (`toMarketTradeQuote` strips it to a quote). */
export async function buildComboTrade(args: ComboTradeArgs): Promise<BuiltMarketTrade> {
  const chainId = args.chainId ?? BASE_CHAIN_ID;
  const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  assertSlippageBounds(slippageBps);
  const onChain = assertComboTradable(
    args.marketId,
    args.onChain === undefined ? await readComboOnChain(args.marketId, chainId) : args.onChain,
    args,
    args.nowMs ?? Date.now(),
  );
  return buildMarketSwap({
    chainId,
    slippageBps,
    marketId: args.marketId,
    marketAddress: onChain.marketAddress,
    yesToken: onChain.yesToken,
    direction: args.direction,
    amountRaw: args.amountRaw,
    subject: `combo ${args.marketId}`,
  });
}

/** The leg results the gate and the ticket read, from the leg rows and the resolutions log. */
export function legResults(
  rows: readonly LegRow[],
  winnerByMarket: ReadonlyMap<string, number>,
): { row: LegRow; result: LegResult }[] {
  return rows.map((row) => ({
    row,
    result: legResultFrom(row.marketState, winnerByMarket.get(row.marketId) ?? null),
  }));
}

/** The `fee` block a planned (pre-creation) quote carries — the hook's own formula. */
export function plannedFeeWire(pricing: ComboPricing, playoffs: boolean) {
  return {
    feePips: pricing.feePips,
    ratePips: playoffs ? MIN_RATE_PIPS : 0,
    probabilityBps: pricing.fairProbabilityBps,
    playoffs,
    feeRaw: pricing.feeUsdcRaw.toString(),
    feeUsdcRaw: pricing.feeUsdcRaw.toString(),
    stale: false,
  };
}
