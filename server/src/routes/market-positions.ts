import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { readMarketPositions } from "../lib/sports/market-positions.ts";

export const marketPositionsRouter = Router();

// The computation, its cache window and key live in
// `lib/sports/market-positions.ts` since task 056 (the agent reads the same
// positions). Re-exported so `market-fills.ts` keeps its invalidation import.
export {
  POSITIONS_CACHE_MS,
  positionsCacheKey,
  type MarketPositionRow,
} from "../lib/sports/market-positions.ts";

/**
 * GET /api/markets/positions?address=0x… — the caller's outcome-token
 * holdings across recent markets, marked at the live pool price (B6-009).
 *
 * Balances and prices are public chain data; auth is required anyway so
 * the endpoint can't be used to enumerate arbitrary wallets anonymously.
 * Entry price / realized P&L need indexed fills and arrive with trade
 * history; this reports live mark value.
 */
marketPositionsRouter.get(
  "/api/markets/positions",
  requireAuth,
  async (req: Request, res: Response) => {
    const address = z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .safeParse(req.query.address);
    if (!address.success) {
      res.status(400).json({ error: "address required", code: "BAD_REQUEST" });
      return;
    }
    const owner = address.data as `0x${string}`;

    try {
      const positions = await readMarketPositions(owner);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ positions });
    } catch (err) {
      logger.warn({ err }, "market-positions: failed");
      res.status(500).json({ error: "Failed to load positions", code: "INTERNAL" });
    }
  },
);
