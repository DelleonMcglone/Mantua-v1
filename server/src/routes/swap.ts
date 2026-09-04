import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { portfolioTransactions } from "../db/schema/trading.ts";
import { users } from "../db/schema/users.ts";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { logAudit } from "../lib/audit.ts";
import { ACTIVE_CHAIN_ID } from "../lib/constants.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { guardSpend, reverseSpending } from "../lib/spending-cap.ts";
import { SafetyError } from "../lib/errors.ts";
import { isTokenSymbol } from "../lib/tokens.ts";
import {
  UnreadableQuoteError,
  fetchSwapTx,
  quoteSpendLeg,
  type UniswapQuote,
} from "../lib/uniswap.ts";
import { PriceUnavailableError, tokenAmountUsd, tokenAmountUsdStrict } from "../lib/usd-pricing.ts";

export const swapRouter = Router();

/**
 * POST /api/swap/calldata — given a quote object the client got from
 * /api/quote (and optionally the user's permit signature), returns the
 * { to, data, value, gasLimit? } the wallet should submit.
 *
 * C-019 — this route can move the user's money once they sign, so the spend
 * is priced server-side from the quote's input leg, checked against the
 * daily cap, and recorded as a ledger intent before any calldata is
 * returned (guardSpend). The old shape — no check, ledger ink only if the
 * client later self-reported — is closed: the record route now only REVERSES
 * the intent on a reported failure.
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
    const wallet = getRequestContext(req).walletAddress;
    if (!wallet) {
      res.status(401).json({ error: "Wallet not linked", code: "WALLET_REQUIRED" });
      return;
    }
    try {
      const { symbol, amountRaw } = quoteSpendLeg(parsed.data.quote);
      const swap = await guardSpend(
        // C-019 — strict pricing: a dead feed throws instead of valuing the
        // spend at $0, so the cap cannot be priced around.
        () => tokenAmountUsdStrict(symbol, amountRaw),
        wallet,
        () => fetchSwapTx(parsed.data.quote as UniswapQuote, parsed.data.signature),
      );
      res.json({ swap });
    } catch (err) {
      if (err instanceof UnreadableQuoteError) {
        res.status(400).json({ error: err.message, code: "QUOTE_UNREADABLE" });
        return;
      }
      if (err instanceof PriceUnavailableError) {
        // Fail-closed: no price, no calldata that could be signed into a trade.
        res.status(503).json({ error: err.message, code: "PRICE_UNAVAILABLE" });
        return;
      }
      if (err instanceof SafetyError) {
        logger.warn({ err, wallet }, "swap calldata: blocked by the spending cap");
        res.status(400).json({ error: err.message, code: err.code, details: err.details });
        return;
      }
      const message = err instanceof Error ? err.message : "calldata failed";
      res
        .status(502)
        .json({ error: "Upstream calldata failed", code: "UPSTREAM_SWAP", details: message });
    }
  },
);

/**
 * POST /api/swap/record — client calls this after the on-chain receipt
 * resolves. Inserts into portfolio_transactions. The daily spend ledger is
 * NOT written here: C-019 moved that ink to calldata issuance (guardSpend in
 * /api/swap/calldata), so a success report is a no-op for the ledger (a
 * second write would double-count one trade) and a FAILURE report reverses
 * the recorded intent.
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

    // C-019 — the intent was already recorded at issuance; a failed trade
    // releases it. Repricing deliberately uses the LENIENT helper: a failure
    // report during a feed outage must still bookkeep (reverse(0) is a safe
    // no-op), and a reversal can only ever reduce headroom error toward
    // zero (reverseSpending floors at 0).
    if (outcome === "failure" && usdValue > 0) {
      await reverseSpending(wallet, usdValue);
    }
    await logAudit({ ...ctx, action: "swap", outcome, txHash, params });
    res.json({ ok: true });
  },
);
