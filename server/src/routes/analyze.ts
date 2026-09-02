import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.ts";
import { runAnalyze, topicSchema } from "../lib/analyze.ts";
import { walletRateLimiter } from "../middleware/rate-limit.ts";

export const analyzeRouter = Router();

/**
 * Public read-only analyze endpoint that backs the home shell's
 * "Analyze & Research" suggestion buttons. Each `?topic=...` value is
 * a one-shot fetcher that hits CoinGecko / DefiLlama and returns a
 * structured `AnalyzeResponse` for the client to render. Open route
 * (no auth) since the data is public; rate-limited per wallet/IP.
 */
analyzeRouter.get("/api/analyze", walletRateLimiter, async (req: Request, res: Response) => {
  const parsed = topicSchema.safeParse(req.query.topic);
  if (!parsed.success) {
    res.status(400).json({
      error: "Unknown analyze topic",
      code: "BAD_REQUEST",
      details: parsed.error.issues,
    });
    return;
  }
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
  try {
    const result = await runAnalyze(parsed.data, symbol);
    res.json(result);
  } catch (err) {
    logger.warn({ err, topic: parsed.data, symbol }, "analyze failed");
    const message = err instanceof Error ? err.message : "Analyze failed";
    res.status(502).json({
      error: `Couldn't pull data right now: ${message}`,
      code: "ANALYZE_UPSTREAM_FAILURE",
    });
  }
});
