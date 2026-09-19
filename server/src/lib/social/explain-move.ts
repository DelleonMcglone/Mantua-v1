/**
 * Task 070 / AE-003 — explain the move. Pure: given the recorded price
 * series, the fills inside the window and the game state, say how far the
 * YES price moved and what best explains it.
 *
 *   illiquid    the pool is thin, so small trades move the price
 *   scoring     the game is live and the score changed in the window
 *   order_flow  one side dominated the fills (≥ 3 fills, ≥ 3:1)
 *   repricing   a notable move with neither — the market is pricing in
 *               information the score does not show yet (AE-004 builds
 *               its forecast on this case)
 *   steady      below the notable threshold
 */

export const NOTABLE_MOVE_BPS = 300;
export const THIN_POOL_USDC = 500;
const FLOW_MIN_FILLS = 3;
const FLOW_RATIO = 3;

export interface MoveInput {
  /** Oldest first; `p` is the YES implied probability 0–1. */
  history: readonly { t: number; p: number }[];
  nowSeconds: number;
  windowSeconds: number;
  /** Fills inside the window. */
  flow: { buys: number; sells: number };
  game: {
    status: "scheduled" | "live" | "final";
    teamScore: number | null;
    opponentScore: number | null;
    scoreChanged: boolean;
    clock: string | null;
  };
  liquidityUsdc: number | null;
}

export type MoveDriver = "illiquid" | "scoring" | "order_flow" | "repricing" | "steady";

export interface MoveExplanation {
  fromBps: number | null;
  toBps: number | null;
  moveBps: number;
  notable: boolean;
  driver: MoveDriver;
  /** Plain sentences, in the order a reader should see them. */
  factors: string[];
}

const bps = (p: number): number => Math.round(p * 10_000);
const pts = (b: number): string =>
  `${b >= 0 ? "+" : "−"}${String(Math.abs(Math.round(b / 100)))} pts`;

function endpoints(input: MoveInput): { from: number | null; to: number | null } {
  const h = input.history;
  if (h.length === 0) return { from: null, to: null };
  const start = input.nowSeconds - input.windowSeconds;
  let from = h[0];
  for (const point of h) if (point.t <= start) from = point;
  return { from: from.p, to: h[h.length - 1].p };
}

/** Pure: the move over the window and its most likely driver. */
export function explainMove(input: MoveInput): MoveExplanation {
  const { from, to } = endpoints(input);
  if (from === null || to === null || input.history.length < 2) {
    return {
      fromBps: from === null ? null : bps(from),
      toBps: to === null ? null : bps(to),
      moveBps: 0,
      notable: false,
      driver: "steady",
      factors: [],
    };
  }
  const fromBps = bps(from);
  const toBps = bps(to);
  const moveBps = toBps - fromBps;
  const notable = Math.abs(moveBps) >= NOTABLE_MOVE_BPS;
  const minutes = Math.round(input.windowSeconds / 60);
  const factors: string[] = [
    `YES moved from ${String(Math.round(fromBps / 100))}% to ${String(Math.round(toBps / 100))}% (${pts(moveBps)}) in the last ${String(minutes)} minutes.`,
  ];
  if (!notable) return { fromBps, toBps, moveBps, notable, driver: "steady", factors };

  const { buys, sells } = input.flow;
  const total = buys + sells;
  const lopsided =
    total >= FLOW_MIN_FILLS && (buys >= sells * FLOW_RATIO || sells >= buys * FLOW_RATIO);
  const thin = input.liquidityUsdc !== null && input.liquidityUsdc < THIN_POOL_USDC;
  const g = input.game;

  let driver: MoveDriver;
  if (thin) {
    driver = "illiquid";
    factors.push(
      `The pool holds under $${String(THIN_POOL_USDC)}, so small trades move the price.`,
    );
  } else if (g.status === "live" && g.scoreChanged) {
    driver = "scoring";
    const score =
      g.teamScore !== null && g.opponentScore !== null
        ? `${String(g.teamScore)}-${String(g.opponentScore)}`
        : "the score";
    factors.push(
      `The game is live at ${score}${g.clock ? ` (${g.clock})` : ""} and the score changed.`,
    );
  } else if (lopsided) {
    driver = "order_flow";
    factors.push(`Order flow was one-sided: ${String(buys)} buys vs ${String(sells)} sells.`);
  } else {
    driver = "repricing";
    factors.push(
      g.status === "live"
        ? "The score did not change, so the market is pricing something the scoreboard does not show."
        : "No game action yet, so the market is pricing information ahead of kickoff.",
    );
  }
  return { fromBps, toBps, moveBps, notable, driver, factors };
}
