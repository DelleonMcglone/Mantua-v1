import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { IS_MAINNET } from "../lib/constants.ts";
import { getBasePool, listBasePools, poolChart } from "../lib/defillama.ts";
import { logger } from "../lib/logger.ts";

export const poolsRouter = Router();

/**
 * P4-001 — GET /api/pools
 * Returns Base Uniswap pools sorted by TVL desc. Open route (no auth)
 * since it's read-only public data; rate-limit applies via the global
 * ipRateLimiter wired in server/src/index.ts.
 *
 * DefiLlama only indexes Base mainnet, so when `MANTUA_NETWORK` is
 * flipped off "mainnet" we return an empty list rather than surfacing
 * pools the user can't actually interact with. Once we start indexing
 * Mantua-created pools, swap this branch for the real source.
 */
poolsRouter.get("/api/pools", async (_req: Request, res: Response) => {
  if (!IS_MAINNET) {
    res.json({ pools: [] });
    return;
  }
  try {
    const pools = await listBasePools();
    res.json({
      pools: pools.map((p) => ({
        id: p.pool,
        symbol: p.symbol,
        project: p.project,
        feeTier: p.poolMeta ?? null,
        tvlUsd: p.tvlUsd,
        apy: p.apy ?? p.apyBase ?? 0,
        volumeUsd1d: p.volumeUsd1d ?? 0,
        volumeUsd7d: p.volumeUsd7d ?? 0,
        underlyingTokens: p.underlyingTokens ?? [],
        stablecoin: p.stablecoin === true,
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /api/pools failed");
    res.status(502).json({ error: "Failed to fetch pools", code: "UPSTREAM_DEFILLAMA" });
  }
});

const detailQuerySchema = z.object({
  range: z.enum(["1D", "7D", "30D", "90D", "1Y", "ALL"]).default("30D"),
});

/**
 * P4-002 — GET /api/pools/:id?range=30D
 * Returns pool snapshot + historical TVL/APY chart points.
 */
poolsRouter.get("/api/pools/:id", async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id) {
    res.status(400).json({ error: "Missing pool id", code: "BAD_REQUEST" });
    return;
  }
  const queryParse = detailQuerySchema.safeParse(req.query);
  if (!queryParse.success) {
    res.status(400).json({ error: "Invalid query", code: "BAD_REQUEST" });
    return;
  }
  const days = rangeToDays(queryParse.data.range);

  try {
    const [pool, chart] = await Promise.all([getBasePool(id), poolChart(id, days)]);
    if (!pool) {
      res.status(404).json({ error: "Pool not found", code: "POOL_NOT_FOUND" });
      return;
    }
    res.json({
      pool: {
        id: pool.pool,
        symbol: pool.symbol,
        project: pool.project,
        feeTier: pool.poolMeta ?? null,
        tvlUsd: pool.tvlUsd,
        apy: pool.apy ?? pool.apyBase ?? 0,
        volumeUsd1d: pool.volumeUsd1d ?? 0,
        volumeUsd7d: pool.volumeUsd7d ?? 0,
        underlyingTokens: pool.underlyingTokens ?? [],
      },
      chart: chart.map((c) => ({
        time: Math.floor(new Date(c.timestamp).getTime() / 1000),
        tvlUsd: c.tvlUsd,
        apy: c.apy ?? c.apyBase ?? 0,
      })),
    });
  } catch (err) {
    logger.error({ err, id }, "GET /api/pools/:id failed");
    res.status(502).json({ error: "Failed to fetch pool", code: "UPSTREAM_DEFILLAMA" });
  }
});

export function rangeToDays(range: "1D" | "7D" | "30D" | "90D" | "1Y" | "ALL"): number {
  switch (range) {
    case "1D":
      return 1;
    case "7D":
      return 7;
    case "30D":
      return 30;
    case "90D":
      return 90;
    case "1Y":
      return 365;
    case "ALL":
      return 100_000;
  }
}
