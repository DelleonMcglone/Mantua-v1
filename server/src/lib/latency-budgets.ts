/**
 * Phase 7 / R-003 — the latency budgets as a leaf module (no imports), so
 * the load-test script (`scripts/load-test.ts`) can read the same numbers
 * the middleware enforces without booting the server's env. Rationale for
 * each number lives in `metrics.ts`.
 */

export type BudgetKey =
  | "quote"
  | "calldata"
  | "fill"
  | "trade_status"
  | "status"
  | "slate"
  | "positions"
  | "stream_open";

export const LATENCY_BUDGETS_MS: Readonly<Record<BudgetKey, number>> = {
  quote: 800,
  calldata: 1_200,
  fill: 2_500,
  trade_status: 600,
  status: 300,
  slate: 500,
  positions: 1_500,
  stream_open: 1_000,
};

/** Client-side confirmation target (receipt wait), p95. Not measured here. */
export const CONFIRMATION_BUDGET_MS = 8_000;

/** Route → budget key. Paths are matched after Express strips nothing
 *  (the rewrite hands the full `/api/...` path to the function). */
export function routeBudgetKey(method: string, path: string): BudgetKey | null {
  const p = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (method === "POST" && p === "/api/markets/trade/quote") return "quote";
  if (method === "POST" && p === "/api/markets/trade/calldata") return "calldata";
  if (method === "POST" && p === "/api/markets/fills") return "fill";
  if (method === "GET" && p === "/api/markets/trade/status") return "trade_status";
  if (method === "GET" && p === "/api/status") return "status";
  if (method === "GET" && p === "/api/sports/slate") return "slate";
  if (method === "GET" && p === "/api/markets/positions") return "positions";
  return null;
}
