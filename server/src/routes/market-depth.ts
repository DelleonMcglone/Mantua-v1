/**
 * Phase 11 — `GET /api/markets/depth?providerEventId=…`: the market page's
 * deeper layer (metrics, depth curve, live game, chart annotations) from
 * `lib/sports/market-depth-read.ts`. Public like the slate and the detail
 * read; cached briefly across instances; an unknown game is a 404.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
import { sharedCache } from "../lib/shared-cache.ts";
import { makeDepthDb } from "../lib/sports/market-depth-db.ts";
import { readMarketDepth, type MarketDepthRead } from "../lib/sports/market-depth-read.ts";

const eventIdSchema = z.string().regex(/^\d{1,32}$/);
const DEPTH_TTL_MS = 15_000;

export interface MarketDepthDeps {
  read: (providerEventId: string) => Promise<MarketDepthRead | null>;
}

export function createMarketDepthRouter(overrides: Partial<MarketDepthDeps> = {}): Router {
  const deps: MarketDepthDeps = {
    read: (id) =>
      sharedCache.getOrCompute(`market-depth:${id}`, DEPTH_TTL_MS, () =>
        readMarketDepth(makeDepthDb(), id),
      ),
    ...overrides,
  };
  const router = Router();
  router.get("/api/markets/depth", async (req: Request, res: Response) => {
    const parsed = eventIdSchema.safeParse(req.query.providerEventId);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid providerEventId", code: "BAD_REQUEST" });
      return;
    }
    try {
      const read = await deps.read(parsed.data);
      if (!read) {
        res.status(404).json({ error: "Unknown game", code: "NOT_FOUND" });
        return;
      }
      res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
      res.json(read);
    } catch (err) {
      logger.error({ err, providerEventId: parsed.data }, "market depth read failed");
      res.status(503).json({ error: "Market depth unavailable", code: "UNAVAILABLE" });
    }
  });
  return router;
}

export const marketDepthRouter = createMarketDepthRouter();
