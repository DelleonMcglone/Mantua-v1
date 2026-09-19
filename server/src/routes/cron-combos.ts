import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { BASE_CHAIN_ID } from "../lib/chains.ts";
import { runComboMonitor } from "../lib/combos/combo-monitor-run.ts";
import { logger } from "../lib/logger.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";

/**
 * Task 072 / CB-009 — GET /api/cron/combos: the combo monitor tick, every
 * fifteen minutes from the GitHub Actions scheduler
 * (`.github/workflows/combos.yml`) behind the cron secret, daily from
 * Vercel as the safety net. Stamps legs, marks dead tickets, manages
 * agent-wallet tickets under an autonomous policy, recommends for the
 * rest. Settlement itself stays with `/api/cron/resolution`.
 */
export const cronCombosRouter = Router();

cronCombosRouter.get(
  "/api/cron/combos",
  requireCronSecret,
  async (_req: Request, res: Response) => {
    const started = Date.now();
    try {
      const outcomes = await runComboMonitor(db, {
        mode: env.AGENT_MODE,
        chainId: BASE_CHAIN_ID,
        nowMs: started,
      });
      const failed = outcomes.filter((o) => o.disposition === "failed").length;
      res.status(failed > 0 ? 207 : 200).json({
        ok: failed === 0,
        tickets: outcomes.length,
        executed: outcomes.filter((o) => o.disposition === "executed").length,
        recommended: outcomes.filter((o) => o.disposition === "recommended").length,
        outcomes,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      logger.error({ err }, "combos: monitor tick failed");
      res.status(500).json({ error: "Combo monitor failed", code: "INTERNAL" });
    }
  },
);
