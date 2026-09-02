import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import { portfolioTransactions } from "../db/schema/trading.ts";
import { users } from "../db/schema/users.ts";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { logAudit } from "../lib/audit.ts";
import { ACTIVE_CHAIN_ID } from "../lib/constants.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { recordSpending } from "../lib/spending-cap.ts";
import { isTokenSymbol } from "../lib/tokens.ts";
import { fetchSwapTx, type UniswapQuote } from "../lib/uniswap.ts";
import { tokenAmountUsd } from "../lib/usd-pricing.ts";

export const swapRouter = Router();

/**
 * POST /api/swap/calldata — given a quote object the client got from
 * /api/quote (and optionally the user's permit signature), returns the
 * { to, data, value, gasLimit? } the wallet should submit.
 */
swapRouter.post(
  "/api/swap/calldata",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const schema = z.object({
      quote: z.unknown(),
      signature: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", code: "BAD_REQUEST" });
      return;
    }
    try {
      const swap = await fetchSwapTx(parsed.data.quote as UniswapQuote, parsed.data.signature);
      res.json({ swap });
    } catch (err) {
      const message = err instanceof Error ? err.message : "calldata failed";
      res
        .status(502)
        .json({ error: "Upstream calldata failed", code: "UPSTREAM_SWAP", details: message });
    }
  },
);

/**
 * POST /api/swap/record — client calls this after the on-chain receipt
 * resolves. Inserts into portfolio_transactions and increments the daily
 * spend ledger (P1-001 recordSpending).
 */
swapRouter.post(
  "/api/swap/record",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const schema = z.object({
      txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      tokenIn: z.string().refine(isTokenSymbol),
      tokenOut: z.string().refine(isTokenSymbol),
      amountInRaw: z.string().regex(/^\d+$/),
      amountOutRaw: z.string().regex(/^\d+$/),
      slippageBps: z.number().int().min(0).max(500).optional(),
      outcome: z.enum(["success", "failure"]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const ctx = getRequestContext(req);
    const wallet = ctx.walletAddress;
    if (!wallet || !req.privyUserId) {
      res.status(401).json({ error: "Auth required", code: "UNAUTHENTICATED" });
      return;
    }

    const { txHash, tokenIn, tokenOut, amountInRaw, amountOutRaw, slippageBps, outcome } =
      parsed.data;

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.privyUserId, req.privyUserId))
      .limit(1);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- drizzle types the row as defined, but the array is empty for an unknown user.
    if (!user) {
      res.status(404).json({ error: "User not found", code: "USER_NOT_FOUND" });
      return;
    }

    const usdValue = await tokenAmountUsd(tokenIn, BigInt(amountInRaw));
    const params = {
      tokenIn,
      tokenOut,
      amountInRaw,
      amountOutRaw,
      ...(slippageBps !== undefined ? { slippageBps } : {}),
    };

    await db.insert(portfolioTransactions).values({
      userId: user.id,
      walletAddress: wallet,
      action: "swap",
      txHash,
      chainId: ACTIVE_CHAIN_ID,
      params,
      outcome,
      usdValue: usdValue > 0 ? usdValue.toFixed(2) : null,
    });

    if (outcome === "success" && usdValue > 0) {
      await recordSpending(wallet, usdValue);
    }
    await logAudit({ ...ctx, action: "swap", outcome, txHash, params });
    res.json({ ok: true });
  },
);
