/**
 * Phase 11 (D-003) — `GET /api/markets/analysis?providerEventId=…&outcomeIndex=0|1`:
 * the analyst's own research for one side of a market, the same
 * `mantua_analyze_market` the agent runs (`sports_intelligence`). It is a
 * deterministic read over the canonical database — no model call — so it
 * is public, cached per side for a minute, and labelled by the client as an
 * agent estimate, never as a market price (T-021).
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { sharedCache } from "../lib/shared-cache.ts";
import { analyzeMarket, makeSportsToolsDb } from "../lib/sports/agent-sports-tools.ts";

const querySchema = z.object({
  providerEventId: z.string().regex(/^\d{1,32}$/),
  outcomeIndex: z.enum(["0", "1"]).default("0"),
});
const ANALYSIS_TTL_MS = 60_000;

export type AnalysisResult = Record<string, unknown> & { status: string };

export interface MarketAnalysisDeps {
  analyze: (providerEventId: string, outcomeIndex: 0 | 1) => Promise<AnalysisResult>;
}

export function createMarketAnalysisRouter(overrides: Partial<MarketAnalysisDeps> = {}): Router {
  const deps: MarketAnalysisDeps = {
    analyze: (id, outcomeIndex) =>
      sharedCache.getOrCompute(
        `market-analysis:${id}:${String(outcomeIndex)}`,
        ANALYSIS_TTL_MS,
        () =>
          analyzeMarket(makeSportsToolsDb(db), {
            providerEventId: id,
            outcomeIndex,
          }) as Promise<AnalysisResult>,
      ),
    ...overrides,
  };
  const router = Router();
  router.get("/api/markets/analysis", async (req: Request, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", code: "BAD_REQUEST" });
      return;
    }
    const outcomeIndex: 0 | 1 = parsed.data.outcomeIndex === "1" ? 1 : 0;
    try {
      const result = await deps.analyze(parsed.data.providerEventId, outcomeIndex);
      if (result.status === "ok") {
        res.setHeader("Cache-Control", "public, max-age=60");
        res.json(result);
        return;
      }
      res.status(result.status === "not_found" ? 404 : 503).json(result);
    } catch (err) {
      logger.error({ err, query: parsed.data }, "market analysis failed");
      res
        .status(503)
        .json({ status: "unavailable", error: "Analysis unavailable", code: "UNAVAILABLE" });
    }
  });
  return router;
}

export const marketAnalysisRouter = createMarketAnalysisRouter();
