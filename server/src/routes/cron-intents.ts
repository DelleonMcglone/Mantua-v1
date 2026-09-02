import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.ts";
import { runIntentSweep } from "../lib/agent-intents.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";

export const cronIntentsRouter = Router();

/**
 * GET /api/cron/intents — retry sweep over all pending standing swap intents
 * (guard-held swaps parked for automatic completion). GET because Vercel Cron
 * invokes endpoints with GET. Protected by the shared cron secret, not Privy
 * auth. No rate limiter (call frequency is the schedule).
 */
cronIntentsRouter.get(
  "/api/cron/intents",
  requireCronSecret,
  async (_req: Request, res: Response) => {
    try {
      const summary = await runIntentSweep();
      logger.info({ summary }, "intent sweep complete");
      res.json(summary);
    } catch (err) {
      logger.error({ err }, "intent sweep failed");
      res.status(500).json({ error: "Intent sweep failed", code: "INTENT_SWEEP_FAILED" });
    }
  },
);
