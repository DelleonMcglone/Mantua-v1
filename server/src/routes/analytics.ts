import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  getBasePool,
  getChainDexOverview,
  getProtocol,
  getTokenPrices,
  listBasePools,
  poolChart,
} from "../lib/defillama.ts";
import { logger } from "../lib/logger.ts";
import { walletRateLimiter } from "../middleware/rate-limit.ts";

export const analyticsRouter = Router();

/**
 * P7-003 — analytics surface (Phase 7's authoritative query routes).
 *
 * The agent's chat-mode "Query On-Chain Data" card (P6-007) hits its
 * own `/api/agent/query` wrapper, which is auth-scoped to the agent
 * user. This `/api/analytics` surface is the broader Phase 7 query
 * layer — same DefiLlama primitives in `server/src/lib/defillama.ts`,
 * but accessible to any authenticated user reading their own dashboard
 * (Phase 8) without going through the agent.
 *
 * All queries are cached for 60s in `defillama.ts` to respect rate
 * limits (P7-005). Authenticated reads are still subject to
 * `walletRateLimiter` to limit per-user fan-out.
 *
 * Query types:
 *   - `pools`         — list of Base v3/v4 Uniswap pools
 *   - `pool`          — single pool by id
 *   - `chart`         — historical TVL + APY for a pool
 *   - `protocol`      — protocol detail (TVL history, chains, etc.) by slug
 *   - `dex_volume`    — DEX overview for a chain (volume, breakdown)
 *   - `token_price`   — current price for a list of coin keys
 *
 * Phase 7 deliberately scopes to these six. P7's tickets call out
 * "protocol TVL, DEX volume, yield APYs, token price, historical
 * charts" — `pools` + `chart` cover yield APYs + historical charts;
 * `protocol`, `dex_volume`, `token_price` are the new additions.
 */
const querySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pools") }),
  z.object({
    type: z.literal("pool"),
    poolId: z.string().regex(/^[a-f0-9-]{36}$/i, "invalid poolId"),
  }),
  z.object({
    type: z.literal("chart"),
    poolId: z.string().regex(/^[a-f0-9-]{36}$/i, "invalid poolId"),
    days: z.coerce.number().int().min(1).max(365).default(30),
  }),
  z.object({
    type: z.literal("protocol"),
    slug: z.string().regex(/^[a-z0-9-]+$/i, "invalid slug"),
  }),
  z.object({
    type: z.literal("dex_volume"),
    chain: z
      .string()
      .regex(/^[a-z0-9-]+$/i, "invalid chain")
      .default("base"),
  }),
  z.object({
    type: z.literal("token_price"),
    coins: z.string().min(1).max(2000), // comma-separated `chain:addr` or `coingecko:id`
  }),
]);

/**
 * GET /api/analytics?type={pools|pool|chart|protocol|dex_volume|token_price}&...
 *
 * No `requireAuth` — DefiLlama itself is open data, and we cap per-IP
 * fan-out via `ipRateLimiter` (mounted globally) plus the per-route
 * `walletRateLimiter`. Switching to `requireAuth` is a one-line add
 * if we decide to gate analytics behind login later.
 */
analyticsRouter.get("/api/analytics", walletRateLimiter, async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid query",
      code: "BAD_REQUEST",
      details: parsed.error.issues,
    });
    return;
  }
  try {
    const q = parsed.data;
    switch (q.type) {
      case "pools": {
        const pools = await listBasePools();
        res.json({ pools });
        return;
      }
      case "pool": {
        const pool = await getBasePool(q.poolId);
        if (!pool) {
          res.status(404).json({ error: "Pool not found", code: "POOL_NOT_FOUND" });
          return;
        }
        res.json({ pool });
        return;
      }
      case "chart": {
        const points = await poolChart(q.poolId, q.days);
        res.json({ points });
        return;
      }
      case "protocol": {
        const protocol = await getProtocol(q.slug);
        if (!protocol) {
          res.status(404).json({ error: "Protocol not found", code: "PROTOCOL_NOT_FOUND" });
          return;
        }
        res.json({ protocol });
        return;
      }
      case "dex_volume": {
        const overview = await getChainDexOverview(q.chain);
        if (!overview) {
          res.status(404).json({ error: "Chain not found", code: "CHAIN_NOT_FOUND" });
          return;
        }
        res.json({ overview });
        return;
      }
      case "token_price": {
        const coins = q.coins
          .split(",")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
        if (coins.length === 0 || coins.length > 50) {
          res.status(400).json({
            error: "coins must be 1–50 comma-separated keys",
            code: "BAD_REQUEST",
          });
          return;
        }
        const prices = await getTokenPrices(coins);
        res.json({ prices });
        return;
      }
    }
  } catch (err) {
    logger.error({ err }, "analytics query failed");
    res.status(502).json({
      error: "Upstream DefiLlama query failed",
      code: "UPSTREAM_FAILURE",
    });
  }
});
