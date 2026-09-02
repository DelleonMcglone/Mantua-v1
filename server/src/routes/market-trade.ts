import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import {
  MarketClosedError,
  NoMarketError,
  buildMarketTrade,
} from "../lib/sports/market-trade-build.ts";
import { isSupportedChainId } from "../lib/chains.ts";

export const marketTradeRouter = Router();

const bodySchema = z.object({
  providerEventId: z.string().min(1).max(32),
  /** 0 = home market, 1 = away market — whose YES the user is trading. */
  outcomeIndex: z.union([z.literal(0), z.literal(1)]),
  /** "buy" spends USDC for YES; "sell" spends YES for USDC. */
  direction: z.enum(["buy", "sell"]).default("buy"),
  /** Exact input in raw units (6dp): USDC for buys, YES tokens for sells. */
  amountRaw: z
    .string()
    .regex(/^\d+$/)
    .refine((v) => BigInt(v) > 0n && BigInt(v) <= 100_000_000_000n, {
      message: "amount out of range",
    }),
  /** Execution chain — omitted means Base (back-compat). */
  chainId: z.number().int().refine(isSupportedChainId, "Unsupported chainId").optional(),
});

/**
 * POST /api/markets/trade/calldata — quote + calldata for one outcome-token
 * trade (B7-003, DM-112 direct leg).
 *
 * The server builds, the USER signs: this route holds no keys and moves no
 * funds. The shared `buildMarketTrade` also powers the strategy executor
 * and the agent, so every path trades identically.
 */
marketTradeRouter.post(
  "/api/markets/trade/calldata",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid trade", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    try {
      const built = await buildMarketTrade({
        providerEventId: parsed.data.providerEventId,
        outcomeIndex: parsed.data.outcomeIndex,
        direction: parsed.data.direction,
        amountRaw: BigInt(parsed.data.amountRaw),
        ...(parsed.data.chainId !== undefined ? { chainId: parsed.data.chainId } : {}),
      });
      res.json(built);
    } catch (err) {
      if (err instanceof NoMarketError) {
        res.status(404).json({ error: "No market for this game yet", code: "NO_MARKET" });
        return;
      }
      if (err instanceof MarketClosedError) {
        res.status(409).json({ error: err.message, code: "BETTING_CLOSED" });
        return;
      }
      logger.warn({ err }, "market-trade: quote failed");
      res.status(502).json({
        error: "Couldn't quote this trade — the pool may lack liquidity at this size.",
        code: "QUOTE_FAILED",
      });
    }
  },
);
