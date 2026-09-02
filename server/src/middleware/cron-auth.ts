import type { RequestHandler } from "express";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";

/**
 * Guards the auto-rebalance cron endpoint with a shared secret. Vercel Cron
 * automatically sends `Authorization: Bearer <CRON_SECRET>`; an external
 * scheduler (cron-job.org, GitHub Actions) can send the same header. If
 * `CRON_SECRET` isn't configured the endpoint is disabled (503) rather than
 * left open.
 */
export const requireCronSecret: RequestHandler = (req, res, next) => {
  const secret = env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ error: "Cron is not configured.", code: "CRON_DISABLED" });
    return;
  }
  const header = req.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (provided !== secret) {
    logger.warn("cron auth rejected");
    res.status(401).json({ error: "Invalid cron secret.", code: "UNAUTHENTICATED" });
    return;
  }
  next();
};
