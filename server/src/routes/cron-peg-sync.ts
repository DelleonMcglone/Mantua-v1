import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.ts";
import { syncEurUsdPegReference, PegSyncUnavailableError } from "../lib/peg-sync.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";

export const cronPegSyncRouter = Router();

/**
 * GET /api/cron/peg-sync — push the live EUR/USD (Pyth) to the Stable Protection
 * hook's peg reference so the USDC/EURC pool reads against the true FX rate. GET
 * because Vercel Cron uses GET; guarded by a shared secret (not Privy). Returns
 * 503 when the keeper's admin key isn't configured.
 */
cronPegSyncRouter.get(
  "/api/cron/peg-sync",
  requireCronSecret,
  async (_req: Request, res: Response) => {
    try {
      const result = await syncEurUsdPegReference();
      logger.info({ result }, "peg-sync complete");
      res.json(result);
    } catch (err) {
      if (err instanceof PegSyncUnavailableError) {
        res.status(503).json({ error: err.message, code: "PEG_SYNC_DISABLED" });
        return;
      }
      logger.error({ err }, "peg-sync failed");
      res.status(500).json({ error: "Peg sync failed", code: "PEG_SYNC_FAILED" });
    }
  },
);
