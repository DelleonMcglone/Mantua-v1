import type { MoveExplanation, MoveInput } from "./explain-move.ts";

/**
 * Task 070 / AE-004 — the changing prediction-market price as a signal
 * for public information. Pure over an explained move.
 *
 * A repricing the scoreboard does not explain means traders are acting on
 * something not yet reported — a lineup, an injury, conditions. The
 * signal names the side the price moved toward and grades its confidence
 * by the size of the move and the depth of the pool: a big move in a deep
 * pool cost someone real money to make; the same move in a shallow pool
 * may be one trader. One-sided flow is momentum and never more than
 * medium confidence, because flow alone can be noise. A scoring move is
 * confirmed by the scoreboard and implies nothing hidden.
 */

export type SignalKind = "news_implied" | "momentum" | "score_confirmed" | "none";
export type SignalConfidence = "low" | "medium" | "high";

export interface SignalInput {
  move: MoveExplanation;
  liquidityUsdc: number | null;
  game: MoveInput["game"];
  /** The team whose YES the market prices. */
  team: string;
}

export interface PriceSignal {
  kind: SignalKind;
  favours: "yes" | "no" | null;
  confidence: SignalConfidence;
  statement: string;
}

const HIGH_MOVE_BPS = 800;
const MEDIUM_MOVE_BPS = 500;
const DEEP_POOL_USDC = 5_000;

function grade(moveBps: number, liquidityUsdc: number | null): SignalConfidence {
  const size = Math.abs(moveBps);
  const deep = liquidityUsdc !== null && liquidityUsdc >= DEEP_POOL_USDC;
  if (!deep) return "low";
  if (size >= HIGH_MOVE_BPS) return "high";
  if (size >= MEDIUM_MOVE_BPS) return "medium";
  return "low";
}

const pts = (b: number): string => String(Math.abs(Math.round(b / 100)));

/** Pure: what the move says about information not yet public. */
export function priceSignal(input: SignalInput): PriceSignal {
  const { move, team } = input;
  const favours: "yes" | "no" = move.moveBps >= 0 ? "yes" : "no";
  const toward = favours === "yes" ? `toward ${team}` : `away from ${team}`;
  switch (move.driver) {
    case "repricing":
      return {
        kind: "news_implied",
        favours,
        confidence: grade(move.moveBps, input.liquidityUsdc),
        statement: `Price moved ${pts(move.moveBps)} pts ${toward} with no scoreboard reason. Markets often price lineup or injury news before it is public; this implies information ${favours === "yes" ? "favouring" : "against"} ${team}.`,
      };
    case "order_flow": {
      const c = grade(move.moveBps, input.liquidityUsdc);
      return {
        kind: "momentum",
        favours,
        confidence: c === "high" ? "medium" : c,
        statement: `One-sided flow moved the price ${pts(move.moveBps)} pts ${toward}. The crowd leans ${favours.toUpperCase()} on ${team}; flow alone can be noise.`,
      };
    }
    case "scoring":
      return {
        kind: "score_confirmed",
        favours,
        confidence: "high",
        statement: `The price followed the scoreboard ${toward}; no hidden information is implied.`,
      };
    case "illiquid":
    case "steady":
      return { kind: "none", favours: null, confidence: "low", statement: "" };
  }
}
