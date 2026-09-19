import { comboOutcome, type LegResult } from "./combo-settlement.ts";

/**
 * Task 072 / CB-009 — what the agent may do with an open combo ticket. A
 * conjunction token cannot cash out one leg, so the mechanism permits
 * exactly three moves: mark the ticket dead the moment a leg loses, sell
 * the whole position once its mark clears the policy's take-profit line,
 * or hedge the last pending leg in that leg's own market so the stake is
 * recovered whichever way the game goes. Pure: the runner executes or
 * recommends according to mode, wallet and policy.
 */

export interface MonitoredLeg {
  marketId: `0x${string}`;
  providerEventId: string;
  outcomeIndex: 0 | 1;
  teamName: string;
  result: LegResult;
  /** Live YES price of this leg, bps; null when unreadable. */
  priceBps: number | null;
}

export interface MonitoredTicket {
  comboId: string;
  status: string;
  /** USDC staked, raw 6dp. */
  stakeRaw: bigint;
  /** Combo pool YES price, bps; null when unreadable. */
  markBps: number | null;
  legs: readonly MonitoredLeg[];
}

export interface MonitorPolicy {
  takeProfitBps: number;
}

/** Hedge only once the combo has real value to protect. */
export const HEDGE_MIN_MARK_BPS = 5_000;

export type ComboAction =
  | { kind: "hold"; reason: string }
  | { kind: "mark_dead"; reason: string }
  | { kind: "take_profit"; markBps: number; reason: string }
  | {
      kind: "hedge_leg";
      /** The leg being hedged. */
      leg: MonitoredLeg;
      /** The opponent's outcome index — the market to buy YES in. */
      hedgeOutcomeIndex: 0 | 1;
      /** USDC to spend on the hedge, raw 6dp: enough to recover the stake. */
      amountRaw: bigint;
      reason: string;
    };

/**
 * USDC that buys `stakeRaw` worth of the opponent's YES at its price:
 * opponent price = 1 − leg price, so the hedge costs stake × (1 − p).
 */
export function hedgeAmountRaw(stakeRaw: bigint, legPriceBps: number): bigint {
  const opponentBps = BigInt(Math.min(Math.max(10_000 - legPriceBps, 1), 9_999));
  return (stakeRaw * opponentBps) / 10_000n;
}

export function planComboManagement(t: MonitoredTicket, policy: MonitorPolicy): ComboAction {
  const verdict = comboOutcome(t.legs.map((l) => l.result));
  if (verdict.kind === "lost") {
    return t.status === "dead"
      ? { kind: "hold", reason: "a leg lost; awaiting settlement" }
      : { kind: "mark_dead", reason: "a leg lost — the combo cannot pay" };
  }
  if (verdict.kind !== "pending") {
    return { kind: "hold", reason: `every leg decided (${verdict.kind}); awaiting settlement` };
  }
  if (t.markBps === null) return { kind: "hold", reason: "combo pool price unreadable" };
  if (t.markBps >= policy.takeProfitBps) {
    return {
      kind: "take_profit",
      markBps: t.markBps,
      reason: `mark ${String(t.markBps)} bps is at or above take-profit ${String(policy.takeProfitBps)} bps`,
    };
  }
  const pending = t.legs.filter((l) => l.result === "pending");
  const last = pending[0];
  if (pending.length === 1 && t.markBps >= HEDGE_MIN_MARK_BPS && last.priceBps !== null) {
    return {
      kind: "hedge_leg",
      leg: last,
      hedgeOutcomeIndex: last.outcomeIndex === 0 ? 1 : 0,
      amountRaw: hedgeAmountRaw(t.stakeRaw, last.priceBps),
      reason: `${String(verdict.won)} of ${String(t.legs.length)} legs won; only ${last.teamName} remains — hedging it recovers the stake either way`,
    };
  }
  return {
    kind: "hold",
    reason: `${String(verdict.won)} won · ${String(pending.length)} pending · mark ${String(t.markBps)} bps`,
  };
}

/** One line for the timeline / push when the runner recommends instead of acting. */
export function describeAction(action: ComboAction): string {
  switch (action.kind) {
    case "hold":
      return action.reason;
    case "mark_dead":
      return "Combo is dead: a leg lost.";
    case "take_profit":
      return `Sell the combo: ${action.reason}.`;
    case "hedge_leg":
      return `Hedge ${action.leg.teamName} for ${(Number(action.amountRaw) / 1e6).toFixed(2)} USDC: ${action.reason}.`;
  }
}
