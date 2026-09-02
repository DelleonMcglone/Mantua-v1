import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { DEFAULT_CHAIN_ID } from "../lib/chains.ts";
import { getTokenHistoricalPrices } from "../lib/defillama.ts";
import { logger } from "../lib/logger.ts";
import { getToken, isTokenSymbol } from "../lib/tokens.ts";
import { rangeToDays } from "./pools.ts";

export const pairPriceChartRouter = Router();

const querySchema = z.object({
  base: z.string().min(1),
  quote: z.string().min(1),
  range: z.enum(["1D", "7D", "30D", "90D", "1Y", "ALL"]).default("30D"),
});

interface RatePoint {
  /** Unix seconds (lightweight-charts `Time`). */
  time: number;
  /** Price of `quote` denominated in `base` (quoteUsd / baseUsd). */
  value: number;
}

/**
 * GET /api/pair-price-chart?base=USDC&quote=EURC&range=30D
 *
 * The pair exchange rate over time — `quote` priced in `base` (e.g. "EURC per
 * USDC", "cbBTC per USDC"). Public read-only data; behind the global rate
 * limiter, no auth.
 *
 * The pool itself has no historical index yet, so we derive the
 * rate from the two tokens' real-asset USD price history (DefiLlama, keyed by
 * each token's `coingeckoId`) and divide quoteUsd / baseUsd per timestamp.
 * Both series are requested with identical window/points so their samples
 * line up by index.
 */
pairPriceChartRouter.get("/api/pair-price-chart", async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
    return;
  }
  const { base, quote, range } = parsed.data;
  if (!isTokenSymbol(base, DEFAULT_CHAIN_ID) || !isTokenSymbol(quote, DEFAULT_CHAIN_ID)) {
    res.status(400).json({ error: "Unknown token symbol", code: "BAD_TOKEN" });
    return;
  }
  if (base === quote) {
    res.status(400).json({ error: "base and quote must differ", code: "BAD_PAIR" });
    return;
  }

  try {
    const baseId = `coingecko:${getToken(base, DEFAULT_CHAIN_ID).coingeckoId}`;
    const quoteId = `coingecko:${getToken(quote, DEFAULT_CHAIN_ID).coingeckoId}`;
    const days = rangeToDays(range);
    // Aim for a ~6h sample cadence — finer periods (sub-hourly) come back
    // sparse/empty from DefiLlama for stablecoin feeds, so short ranges like
    // 7D would otherwise yield no points. Clamp so 1D still has a few samples
    // and long ranges stay bounded.
    const samples = Math.min(160, Math.max(8, Math.round((days * 24) / 6)));
    const series = await getTokenHistoricalPrices([baseId, quoteId], days, samples);

    const baseSeries = series[baseId] ?? [];
    const quoteSeries = series[quoteId] ?? [];
    const n = Math.min(baseSeries.length, quoteSeries.length);

    const points: RatePoint[] = [];
    for (let i = 0; i < n; i++) {
      const [tsMs, basePx] = baseSeries[i];
      const quotePx = quoteSeries[i][1];
      if (basePx <= 0 || quotePx <= 0) continue; // skip gaps / bad samples
      points.push({ time: Math.floor(tsMs / 1000), value: quotePx / basePx });
    }

    res.json({ base, quote, points });
  } catch (err) {
    logger.error({ err }, "GET /api/pair-price-chart failed");
    res.status(500).json({ error: "Failed to build pair chart", code: "PAIR_CHART_FAILED" });
  }
});
