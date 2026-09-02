import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.ts";
import { runAutoRebalance } from "../lib/agent-rebalance.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";

export const cronRebalanceRouter = Router();

/**
 * GET /api/cron/rebalance — autonomous peg de-peg-exit rebalance sweep over all
 * opted-in agent wallets. GET because Vercel Cron invokes endpoints with GET.
 * Protected by a shared secret (Vercel Cron / external scheduler), not Privy
 * auth. No rate limiter (call frequency is the schedule).
 */
cronRebalanceRouter.get(
  "/api/cron/rebalance",
  requireCronSecret,
  async (_req: Request, res: Response) => {
    try {
      const summary = await runAutoRebalance();
      logger.info({ summary }, "auto-rebalance sweep complete");
      res.json(summary);
    } catch (err) {
      logger.error({ err }, "auto-rebalance sweep failed");
      res.status(500).json({ error: "Rebalance sweep failed", code: "REBALANCE_FAILED" });
    }
  },
);
