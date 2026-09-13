/**
 * Phase 12 (D-007) — `GET /api/markets/history?league=nfl&limit=30`: resolved
 * markets with the final score, the outcome, the settlement price, and a
 * sampled price path. Public chain-and-scores data, cached a minute.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
import { sharedCache } from "../lib/shared-cache.ts";
import { readMarketHistory } from "../lib/sports/market-history-db.ts";
import type { HistoryRow } from "../lib/sports/market-history.ts";

const querySchema = z.object({
  league: z
    .string()
    .regex(/^[a-z0-9-]{2,16}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const HISTORY_TTL_MS = 60_000;

export interface MarketHistoryDeps {
  read: (league: string | null, limit: number) => Promise<HistoryRow[]>;
}

export function createMarketHistoryRouter(overrides: Partial<MarketHistoryDeps> = {}): Router {
  const deps: MarketHistoryDeps = {
    read: (league, limit) =>
      sharedCache.getOrCompute(
        `market-history:${league ?? "all"}:${String(limit)}`,
        HISTORY_TTL_MS,
        () => readMarketHistory({ league, limit }),
      ),
    ...overrides,
  };
  const router = Router();
  router.get("/api/markets/history", async (req: Request, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", code: "BAD_REQUEST" });
      return;
    }
    try {
      const rows = await deps.read(parsed.data.league ?? null, parsed.data.limit);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
      res.json({ rows, fetchedAt: Date.now() });
    } catch (err) {
      logger.error({ err, query: parsed.data }, "market history read failed");
      res.status(503).json({ error: "Market history unavailable", code: "UNAVAILABLE" });
    }
  });
  return router;
}

export const marketHistoryRouter = createMarketHistoryRouter();
