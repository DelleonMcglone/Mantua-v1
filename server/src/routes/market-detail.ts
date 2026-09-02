import { Router, type Request, type Response } from "express";
import { asc, desc, eq, inArray, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { events, marketComments, marketFills, markets } from "../db/schema/index.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { getTokenHolders } from "../lib/basescan.ts";

export const marketDetailRouter = Router();

const eventIdSchema = z.string().regex(/^\d{1,32}$/);

/** One traded price point, derived from an indexed fill. */
interface PricePoint {
  t: number;
  outcomeIndex: number;
  priceBps: number;
}

interface ActivityRow {
  t: number;
  address: string;
  direction: string;
  outcomeIndex: number;
  usdc: number;
  tokens: number;
  txHash: string;
}

/**
 * GET /api/markets/detail?providerEventId=… — everything the market detail
 * view needs beyond the slate: the fill-derived price series (chart), the
 * recent trades (activity), and the top YES-token holders per outcome.
 *
 * Public by design, like the slate — all of it is public chain data. A game
 * with no on-chain markets yet returns empty collections, not an error.
 */
marketDetailRouter.get("/api/markets/detail", async (req: Request, res: Response) => {
  const parsed = eventIdSchema.safeParse(req.query.providerEventId);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid providerEventId", code: "BAD_REQUEST" });
    return;
  }
  const providerEventId = parsed.data;

  try {
    const rows = await db
      .select({
        marketId: markets.marketId,
        outcomeIndex: markets.outcomeIndex,
        yesToken: markets.yesToken,
      })
      .from(markets)
      .innerJoin(events, eq(markets.eventId, events.id))
      .where(and(eq(events.providerEventId, providerEventId), eq(markets.marketType, "moneyline")));

    if (rows.length === 0) {
      res.setHeader("Cache-Control", "public, max-age=30");
      res.json({ hasMarkets: false, prices: [], activity: [], holders: [] });
      return;
    }

    const outcomeByMarket = new Map(rows.map((r) => [r.marketId, r.outcomeIndex]));
    const marketIds = rows.map((r) => r.marketId);

    const fills = await db
      .select()
      .from(marketFills)
      .where(inArray(marketFills.marketId, marketIds))
      .orderBy(asc(marketFills.createdAt))
      .limit(500);

    const prices: PricePoint[] = [];
    for (const f of fills) {
      const tokens = Number(f.tokensRaw);
      const usdc = Number(f.usdcRaw);
      if (!(tokens > 0) || !(usdc >= 0)) continue;
      prices.push({
        t: Math.floor(f.createdAt.getTime() / 1000),
        outcomeIndex: outcomeByMarket.get(f.marketId) ?? 0,
        priceBps: Math.round((usdc / tokens) * 10_000),
      });
    }

    const recent = await db
      .select()
      .from(marketFills)
      .where(inArray(marketFills.marketId, marketIds))
      .orderBy(desc(marketFills.createdAt))
      .limit(25);
    const activity: ActivityRow[] = recent.map((f) => ({
      t: Math.floor(f.createdAt.getTime() / 1000),
      address: f.address,
      direction: f.direction,
      outcomeIndex: outcomeByMarket.get(f.marketId) ?? 0,
      usdc: Number(f.usdcRaw) / 1e6,
      tokens: Number(f.tokensRaw) / 1e6,
      txHash: f.txHash,
    }));

    // Holders are best-effort — a BaseScan hiccup must not blank the page.
    const holders = await Promise.all(
      rows
        .filter((r): r is typeof r & { yesToken: string } => typeof r.yesToken === "string")
        .map(async (r) => {
          const h = await getTokenHolders(r.yesToken, 8).catch(() => ({
            holders: [],
            top10Pct: 0,
          }));
          return { outcomeIndex: r.outcomeIndex, ...h };
        }),
    );

    res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
    res.json({ hasMarkets: true, prices, activity, holders });
  } catch (err) {
    logger.error({ err, providerEventId }, "market-detail: failed");
    res.status(500).json({ error: "Market detail unavailable", code: "INTERNAL" });
  }
});

/**
 * GET /api/markets/comments?providerEventId=… — the game's comment thread,
 * newest first. Public read, like every browse surface.
 */
marketDetailRouter.get("/api/markets/comments", async (req: Request, res: Response) => {
  const parsed = eventIdSchema.safeParse(req.query.providerEventId);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid providerEventId", code: "BAD_REQUEST" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(marketComments)
      .where(eq(marketComments.providerEventId, parsed.data))
      .orderBy(desc(marketComments.createdAt))
      .limit(50);
    res.json({
      comments: rows.map((c) => ({
        id: c.id,
        address: c.address,
        body: c.body,
        t: Math.floor(c.createdAt.getTime() / 1000),
      })),
    });
  } catch (err) {
    logger.error({ err }, "market-comments: list failed");
    res.status(500).json({ error: "Comments unavailable", code: "INTERNAL" });
  }
});

const commentBodySchema = z.object({
  providerEventId: eventIdSchema,
  body: z.string().trim().min(1).max(400),
});

/**
 * POST /api/markets/comments — add a comment as the signed-in wallet.
 * The wallet address is the public author identity; rate-limited like
 * every other write.
 */
marketDetailRouter.post(
  "/api/markets/comments",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = commentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid comment", code: "BAD_REQUEST" });
      return;
    }
    const address = req.walletAddress;
    if (!address) {
      res.status(400).json({ error: "No wallet on account", code: "NO_WALLET" });
      return;
    }
    try {
      const [row] = await db
        .insert(marketComments)
        .values({
          providerEventId: parsed.data.providerEventId,
          address,
          body: parsed.data.body,
        })
        .returning();
      res.json({
        comment: {
          id: row.id,
          address: row.address,
          body: row.body,
          t: Math.floor(row.createdAt.getTime() / 1000),
        },
      });
    } catch (err) {
      logger.error({ err }, "market-comments: insert failed");
      res.status(500).json({ error: "Could not post comment", code: "INTERNAL" });
    }
  },
);
