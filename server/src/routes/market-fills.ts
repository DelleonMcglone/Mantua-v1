import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import { marketFills } from "../db/schema/index.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { getRpcClient } from "../lib/rpc-client.ts";
import { DEFAULT_CHAIN_ID, isSupportedChainId } from "../lib/chains.ts";
import { MARKETS_PERIPHERY_BY_CHAIN } from "../lib/markets-contracts.ts";

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

      await db
        .insert(marketFills)
        .values({
          address: tx.from.toLowerCase(),
          marketId,
          direction,
          tokensRaw,
          usdcRaw,
          txHash: txHash.toLowerCase(),
        })
        .onConflictDoNothing({ target: marketFills.txHash });
      res.status(201).json({ ok: true });
    } catch (err) {
      logger.warn({ err, txHash }, "market-fills: verification failed");
      res.status(422).json({ error: "Couldn't verify the transaction", code: "VERIFY_FAILED" });
    }
  },
);
