import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { listBasePools, getBasePool, poolChart } from "../lib/defillama.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { walletRateLimiter } from "../middleware/rate-limit.ts";

export const agentQueryRouter = Router();

/**
 * P6-007 — agent's query surface for on-chain / market data. Thin
 * authenticated wrapper around `server/src/lib/defillama.ts`. The
 * fuller analytics surface (token prices, protocol TVL, top yields,
 * historical charts) is Phase 7's job (P7-001 → P7-006); P6-007 just
 * gives the agent's chat-mode "Query On-Chain Data" card a single
 * server-side route to call so it isn't inert. Phase 7 will add more
 * query types under the same `/api/agent/query/...` prefix.
 *
 * Routing: `?type=pools` → list Base v3/v4 Uniswap pools.
 *          `?type=pool&poolId=...` → one pool's metadata.
 *          `?type=chart&poolId=...&days=N` → historical TVL + APY.
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
]);

agentQueryRouter.get(
  "/api/agent/query",
  walletRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    if (!req.privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
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
      if (parsed.data.type === "pools") {
        const pools = await listBasePools();
        res.json({ pools });
        return;
      }
      if (parsed.data.type === "pool") {
        const pool = await getBasePool(parsed.data.poolId);
        if (!pool) {
          res.status(404).json({ error: "Pool not found", code: "POOL_NOT_FOUND" });
          return;
        }
        res.json({ pool });
        return;
      }
      // type === "chart"
      const points = await poolChart(parsed.data.poolId, parsed.data.days);
      res.json({ points });
    } catch (err) {
      logger.error({ err }, "agent query failed");
      res.status(502).json({
        error: "Upstream DefiLlama query failed",
        code: "UPSTREAM_FAILURE",
      });
    }
  },
);
