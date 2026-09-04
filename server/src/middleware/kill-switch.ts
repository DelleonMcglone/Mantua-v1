import type { RequestHandler } from "express";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The Vercel-cron money loops (C-020). All three are GET routes — Vercel
 * Cron always GETs — so the write-method gate never saw them, yet each
 * executes real agent-signed trades:
 *   - /api/cron/rebalance  → runAutoRebalance()      → agent swaps
 *   - /api/cron/intents    → runIntentSweep()        → agent swap retries
 *   - /api/cron/strategies → executeTriggeredClose() → on-chain position closes
 * Enumerated exactly on purpose: the read-only crons (peg-sync, resolution,
 * sports-sync) keep running while the switch is engaged.
 */
const MONEY_CRON_PATHS: ReadonlySet<string> = new Set([
  "/api/cron/rebalance",
  "/api/cron/intents",
  "/api/cron/strategies",
]);

/** Express routes match with or without a trailing slash; the refusal set must cover both spellings. */
function withoutTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

export function createKillSwitchGate({ envEngaged }: { envEngaged: boolean }): RequestHandler {
  return (req, res, next) => {
    if (!envEngaged) {
      next();
      return;
    }
    if (!WRITE_METHODS.has(req.method) && !MONEY_CRON_PATHS.has(withoutTrailingSlash(req.path))) {
      next();
      return;
    }
    logger.warn({ method: req.method, path: req.path }, "kill switch refused request");
    res.status(503).json({
      error: "Mantua trading and write operations are temporarily disabled.",
      code: "KILL_SWITCH_ACTIVE",
    });
  };
}

export const killSwitch: RequestHandler = createKillSwitchGate({
  envEngaged: env.MANTUA_KILL_SWITCH,
});
