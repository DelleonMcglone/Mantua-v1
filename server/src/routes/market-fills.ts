import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { marketFills, marketPositions, marketPrices, users } from "../db/schema/index.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { getRpcClient } from "../lib/rpc-client.ts";
import { DEFAULT_CHAIN_ID, isSupportedChainId } from "../lib/chains.ts";
import { MARKETS_PERIPHERY_BY_CHAIN } from "../lib/markets-contracts.ts";
import { fillImpliedProbability } from "../lib/sports/market-metrics.ts";

export const marketFillsRouter = Router();

const bodySchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  marketId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  direction: z.enum(["buy", "sell"]),
  tokensRaw: z.string().regex(/^\d{1,30}$/),
  usdcRaw: z.string().regex(/^\d{1,30}$/),
  /** Chain the fill happened on — omitted means Base (back-compat). */
  chainId: z.number().int().refine(isSupportedChainId, "Unsupported chainId").optional(),
});

/**
 * POST /api/markets/fills — record one confirmed trade for entry-price /
 * P&L accounting (B6-009's final slice).
 *
 * Trust-but-verify: the client reports its own fill, and the server checks
 * the receipt before believing it — the tx must exist, have succeeded,
 * target OUR swap router, and have been sent by the address being credited.
 * Amounts are taken from the quote the client executed against (exact
 * log decoding can tighten this later). `tx_hash` is unique, so replays
 * and double-submits no-op.
 */
marketFillsRouter.post(
  "/api/markets/fills",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid fill", code: "BAD_REQUEST" });
      return;
    }
    const { txHash, marketId, direction, tokensRaw, usdcRaw } = parsed.data;

    try {
      const chainId = parsed.data.chainId ?? DEFAULT_CHAIN_ID;
      const periphery = MARKETS_PERIPHERY_BY_CHAIN[chainId];
      if (!periphery?.poolSwapTest) {
        res.status(400).json({ error: "Markets not deployed on this chain", code: "BAD_CHAIN" });
        return;
      }
      const client = getRpcClient(chainId);
      const [receipt, tx] = await Promise.all([
        client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
        client.getTransaction({ hash: txHash as `0x${string}` }),
      ]);
      if (receipt.status !== "success") {
        res.status(422).json({ error: "Transaction did not succeed", code: "TX_FAILED" });
        return;
      }
      if (tx.to?.toLowerCase() !== periphery.poolSwapTest.toLowerCase()) {
        res.status(422).json({ error: "Not a market trade", code: "WRONG_TARGET" });
        return;
      }

      const address = tx.from.toLowerCase();
      const inserted = await db
        .insert(marketFills)
        .values({
          address,
          marketId,
          direction,
          tokensRaw,
          usdcRaw,
          txHash: txHash.toLowerCase(),
        })
        .onConflictDoNothing({ target: marketFills.txHash })
        .returning({ id: marketFills.id });

      // P-011 + P-006 — the receipt-verified fill is the server-side event
      // every downstream record derives from: one price tick (the trade's
      // effective price) and the position-mirror update. Both are gated on
      // the fill actually inserting, so a re-POST of the same tx (conflict
      // → no row returned) writes nothing twice. Best-effort: the fill row
      // is the primary record; bookkeeping failures log, never 500.
      if (inserted.length > 0) {
        try {
          // requireAuth guarantees privyUserId; belt-and-braces fallback.
          if (req.privyUserId) {
            await recordFillArtifacts(req.privyUserId, marketId, direction, tokensRaw, usdcRaw, address);
          }
        } catch (err) {
          logger.warn({ err, txHash }, "market-fills: tick/position bookkeeping failed");
        }
      }
      res.status(201).json({ ok: true });
    } catch (err) {
      logger.warn({ err, txHash }, "market-fills: verification failed");
      res.status(422).json({ error: "Couldn't verify the transaction", code: "VERIFY_FAILED" });
    }
  },
);

/** users.id for the authenticated caller, inserting the row on first sight
 *  (the fiat-store ensureUser pattern). */
async function ensureUserId(privyUserId: string, primaryAddress: string): Promise<string> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const found = existing.at(0);
  if (found) return found.id;
  const inserted = await db
    .insert(users)
    .values({ privyUserId, primaryAddress })
    .onConflictDoNothing({ target: users.privyUserId })
    .returning({ id: users.id });
  const row = inserted.at(0);
  if (row) return row.id;
  const reread = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const rerow = reread.at(0);
  if (!rerow) throw new Error("could not ensure a users row for the fill");
  return rerow.id;
}

/**
 * The per-fill bookkeeping behind P-011/P-006:
 *
 *  - **price tick** — the fill's effective price (`usdc / tokens`) lands in
 *    `market_prices` as source `fill`, which is what the chart, history.ts
 *    and the agent's price tools read;
 *  - **position mirror** — one aggregate `market_positions` row per
 *    (market, wallet, side). Buys grow `size` and re-average `entryPrice`
 *    in a single atomic upsert (RHS expressions see the OLD row, so the
 *    weighted average is race-safe under the unique); sells shrink `size`
 *    at average cost, floored at zero. Fills index YES-side trades, so
 *    `side` is always "yes" here.
 *
 * Exported for the scratch-DB migration smoke.
 */
export async function recordFillArtifacts(
  privyUserId: string,
  marketId: string,
  direction: "buy" | "sell",
  tokensRaw: string,
  usdcRaw: string,
  address: string,
): Promise<void> {
  const probability = fillImpliedProbability(usdcRaw, tokensRaw);
  if (probability !== null) {
    await db.insert(marketPrices).values({
      marketId,
      impliedProbability: probability,
      source: "fill",
    });
  }

  const tokens = sql`${tokensRaw}::numeric`;
  if (direction === "buy") {
    const userId = await ensureUserId(privyUserId, address);
    await db
      .insert(marketPositions)
      .values({
        userId,
        marketId,
        walletAddress: address,
        side: "yes",
        size: tokensRaw,
        entryPrice: probability,
      })
      .onConflictDoUpdate({
        target: [marketPositions.marketId, marketPositions.walletAddress, marketPositions.side],
        set: {
          // Weighted-average entry across the aggregate; every RHS reads
          // the pre-update row, so entryPrice averages over the OLD size.
          entryPrice:
            probability === null
              ? sql`${marketPositions.entryPrice}`
              : sql`round(((coalesce(${marketPositions.entryPrice}, 0) * ${marketPositions.size} + ${probability}::numeric * ${tokens}) / nullif(${marketPositions.size} + ${tokens}, 0)), 5)`,
          size: sql`${marketPositions.size} + ${tokens}`,
          updatedAt: sql`now()`,
        },
      });
    return;
  }

  // Sell: reduce the aggregate at average cost. Tokens sold that the mirror
  // never saw bought (e.g. acquired by split) floor at zero rather than
  // going negative — the chain stays authoritative for actual balances.
  await db
    .update(marketPositions)
    .set({ size: sql`greatest(${marketPositions.size} - ${tokens}, 0)`, updatedAt: sql`now()` })
    .where(
      and(
        eq(marketPositions.marketId, marketId),
        eq(marketPositions.walletAddress, address),
        eq(marketPositions.side, "yes"),
      ),
    );
}
