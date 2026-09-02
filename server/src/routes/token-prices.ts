import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
import { isTokenSymbol, type TokenSymbol } from "../lib/tokens.ts";
import { getUsdPrice } from "../lib/usd-pricing.ts";

export const tokenPricesRouter = Router();

const querySchema = z.object({
  symbols: z.string().min(1),
});

/**
 * USD spot prices for a comma-separated list of token symbols. Used by
 * the create-pool form to mirror Token A → Token B at a real-world
 * exchange ratio (`priceA / priceB`) instead of forcing the user to
 * type both sides.
 *
 * Cached at the `getUsdPrice` layer (60s TTL via the CoinGecko
 * `usd-pricing` cache); failures fall back to `0` per-symbol so the
 * client can decide whether to skip the mirror or default to 1:1.
 */
tokenPricesRouter.get("/api/token-prices", async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing symbols", code: "BAD_REQUEST" });
    return;
  }
  const symbols = parsed.data.symbols.split(",").map((s) => s.trim());
  const valid: TokenSymbol[] = symbols.filter((s): s is TokenSymbol => isTokenSymbol(s));
  if (valid.length === 0) {
    res.json({ prices: {} });
    return;
  }
  try {
    const entries = await Promise.all(
      valid.map(async (sym) => [sym, await getUsdPrice(sym)] as const),
    );
    const prices: Record<string, number> = {};
    for (const [sym, price] of entries) prices[sym] = price;
    res.json({ prices });
  } catch (err) {
    logger.warn({ err }, "/api/token-prices failed");
    res.json({ prices: {} });
  }
});
