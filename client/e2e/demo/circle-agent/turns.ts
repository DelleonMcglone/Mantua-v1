/**
 * The three turns of the Circle Sports Agent demo, in the agent stream's
 * wire format: the Daily Brief (the chip), the instruction (typed into the
 * dock) and the confirm (the preview card's button). Frames are served by
 * `record.ts` with their pauses so the words arrive the way a model's do.
 */
import { done, result, session, start, words, type Frame } from "../turns.ts";
import { ANALYSIS, BRIEF, EXECUTION, SIMULATION } from "./data.ts";

export interface Turn {
  /** How the turn is sent: the chip, the dock, or the preview's button. */
  send: "chip" | "dock" | "confirm";
  /** The dock text for a typed turn. */
  prompt?: string;
  frames: Frame[];
}

export const BRIEF_TURN: Turn = {
  send: "chip",
  frames: [
    session,
    ...words("Pulling your wallet, positions, record and today's slate. "),
    start("d1", "mantua_daily_brief"),
    result("d1", "mantua_daily_brief", BRIEF, 1100),
    ...words(
      "Wallet healthy, one open position in the green. Chiefs at Raiders is priced 50% for Las Vegas at home; my estimate is 57% for Kansas City — a 7-point edge worth a look. ",
    ),
    ...words("Want me to size it under your policy?"),
    done,
  ],
};

export const PLAN_TURN: Turn = {
  send: "dock",
  prompt: "Take $10 of YES on the Chiefs if the edge holds. Preview it first.",
  frames: [
    session,
    ...words("Checking the matchup, then sizing it to your policy. "),
    start("p1", "mantua_analyze_market"),
    result("p1", "mantua_analyze_market", ANALYSIS, 1000),
    ...words(
      "Form, health and the head-to-head all lean Kansas City; the market still prices the Raiders at even money at home. ",
    ),
    start("p2", "mantua_simulate_trade", 500),
    result("p2", "mantua_simulate_trade", SIMULATION, 1000),
    ...words(
      "Sized at $10.00 — within your $10 per-trade cap and $25 daily cap. Press Confirm trade and I'll place it from your agent wallet.",
    ),
    done,
  ],
};

export const CONFIRM_TURN: Turn = {
  send: "confirm",
  frames: [
    session,
    ...words(
      "Placing it from your agent wallet — gas sponsored by Circle, settled in USDC on Arc. ",
    ),
    start("c1", "mantua_execute_trade", 400),
    result("c1", "mantua_execute_trade", EXECUTION, 1600),
    ...words(
      "Done: 19.6 Chiefs YES at 51¢, $15.00 of today's cap left. I'll mark the position live and brief you after the game.",
    ),
    done,
  ],
};

export const TURNS: Turn[] = [BRIEF_TURN, PLAN_TURN, CONFIRM_TURN];
