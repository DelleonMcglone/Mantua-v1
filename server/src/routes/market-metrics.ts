import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
import { getMarketMetrics } from "../lib/sports/market-metrics.ts";

export const marketMetricsRouter = Router();

/** The deterministic B0-004 market id — 0x-prefixed keccak256. */
const marketIdSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

/**
 * 038 / S-010 — GET /api/markets/:marketId/metrics: Mantua's own
 * market-data snapshot for one market (price + history, volume, open
 * interest, activity, concentration, liquidity, timing), computed from
 * what the platform already records.
 *
 * Authless public read, exactly like /api/markets/pools — this is public
 * market data. Rate limiting rides the global ipRateLimiter, and the
 * 15s server-side TTL cache plus matching CDN headers keep bursts off
 * the database. Unknown market → 404, never an empty fabrication.
 */
marketMetricsRouter.get(
  "/api/markets/:marketId/metrics",
  async (req: Request, res: Response) => {
    const parsed = marketIdSchema.safeParse(req.params.marketId);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid marketId", code: "BAD_REQUEST" });
      return;
    }
    try {
      const metrics = await getMarketMetrics(parsed.data);
      if (metrics === null) {
        res.status(404).json({ error: "Unknown market", code: "NOT_FOUND" });
        return;
      }
      res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
      res.json({ metrics });
    } catch (err) {
      logger.error({ err, marketId: parsed.data }, "market-metrics: failed");
      res.status(500).json({ error: "Market metrics unavailable", code: "INTERNAL" });
    }
  },
);
