/**
 * The trade ticket's tap budget as a pure state machine (task 050, T-002 /
 * T-011). The UI dispatches one `TicketTap` per user interaction and this
 * reducer decides where the ticket is; the tests count the taps from an
 * empty ticket to an executing trade and assert the budget. Kept free of
 * React so it runs under node:test like `market-trade-core.ts`.
 *
 * Taps are app interactions only: the wallet's own signature prompt is
 * outside the app and is not counted.
 */
import { rawToHuman6 } from "./market-trade-core.ts";

export type Side = 0 | 1;
export type Direction = "buy" | "sell";
export type TicketStep = "pick" | "amount" | "executing" | "executed" | "error";

export interface TicketState {
  step: TicketStep;
  side: Side | null;
  direction: Direction;
  /** Human units: dollars for buys, contracts for sells. */
  amount: string;
}

export type TicketTap =
  | { kind: "pick"; side: Side }
  | { kind: "preset"; amount: number }
  | { kind: "type"; amount: string }
  | { kind: "direction"; direction: Direction }
  /** One-click Close: sell the whole held balance (raw 6dp). */
  | { kind: "close"; side: Side; balanceRaw: string }
  | { kind: "confirm" }
  | { kind: "executed" }
  | { kind: "failed" }
  | { kind: "reset" };

/** Three is the budget — price tap, amount tap, confirm tap. */
export const TAP_BUDGET = 3;

/** One-tap amounts, in dollars. Presets SET the amount; they never stack. */
export const AMOUNT_PRESETS: readonly number[] = [10, 25, 50, 100];

export function initialTicket(): TicketState {
  return { step: "pick", side: null, direction: "buy", amount: "0" };
}

function positive(amount: string): boolean {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0;
}

export function tapTicket(state: TicketState, tap: TicketTap): TicketState {
  switch (tap.kind) {
    case "pick":
      return { ...state, step: "amount", side: tap.side };
    case "preset":
      return state.side === null ? state : { ...state, step: "amount", amount: String(tap.amount) };
    case "type":
      return state.side === null ? state : { ...state, step: "amount", amount: tap.amount };
    case "direction":
      // Units differ between buys (dollars) and sells (contracts), so a
      // stale number must not survive the switch.
      return {
        ...state,
        step: state.side === null ? "pick" : "amount",
        direction: tap.direction,
        amount: "0",
      };
    case "close":
      return {
        step: "amount",
        side: tap.side,
        direction: "sell",
        amount: rawToHuman6(tap.balanceRaw),
      };
    case "confirm":
      if (state.side === null || !positive(state.amount)) return state;
      return { ...state, step: "executing" };
    case "executed":
      return { ...state, step: "executed" };
    case "failed":
      return { ...state, step: "error" };
    case "reset":
      return { ...state, step: "amount", amount: "0" };
  }
}

/** Count the taps in a sequence — what the budget is measured against. */
export function countTaps(taps: readonly TicketTap[]): number {
  return taps.filter((t) => t.kind !== "executed" && t.kind !== "failed").length;
}

/**
 * T-013 — does the ticket need funding before it can execute? Only buys
 * spend dollars; an unknown balance never blocks (the wallet's own check
 * is the backstop).
 */
export function needsFunding(
  direction: Direction,
  totalRaw: string,
  balanceRaw: string | null,
): boolean {
  if (direction !== "buy" || balanceRaw === null) return false;
  return BigInt(balanceRaw) < BigInt(totalRaw);
}

export type TicketReadiness = "login" | "fund" | "ready" | "waiting";

/** Which single primary button the ticket shows. */
export function ticketReadiness(input: {
  authenticated: boolean;
  quoted: boolean;
  funding: boolean;
}): TicketReadiness {
  if (!input.authenticated) return "login";
  if (!input.quoted) return "waiting";
  return input.funding ? "fund" : "ready";
}
