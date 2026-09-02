import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { logAudit } from "../lib/audit.ts";
import { ACTIVE_CHAIN_ID } from "../lib/constants.ts";
import { SafetyError } from "../lib/errors.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { classifySlippage } from "../lib/slippage.ts";
import { checkSpendingCap } from "../lib/spending-cap.ts";
import { getToken, isTokenSymbol, ZERO_ADDRESS } from "../lib/tokens.ts";
import { fetchQuote } from "../lib/uniswap.ts";
import { tokenAmountUsd } from "../lib/usd-pricing.ts";

export const quoteRouter = Router();

const quoteRequestSchema = z.object({
  tokenIn: z.string().refine(isTokenSymbol, "Unknown tokenIn"),
  tokenOut: z.string().refine(isTokenSymbol, "Unknown tokenOut"),
  amountRaw: z.string().regex(/^\d+$/, "amountRaw must be a non-negative integer string"),
  type: z.enum(["EXACT_INPUT", "EXACT_OUTPUT"]).default("EXACT_INPUT"),
  slippageBps: z.number().int().min(0).max(10_000).optional(),
});

quoteRouter.post(
  "/api/quote",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = quoteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const ctx = getRequestContext(req);
    const wallet = ctx.walletAddress;
    if (!wallet) {
      res.status(401).json({ error: "Wallet not linked", code: "WALLET_REQUIRED" });
      return;
    }
    const { tokenIn, tokenOut, amountRaw, type, slippageBps } = parsed.data;
    if (tokenIn === tokenOut) {
      res.status(400).json({ error: "tokenIn and tokenOut must differ", code: "BAD_REQUEST" });
      return;
    }

    try {
      const slippageWarning = slippageBps !== undefined ? classifySlippage(slippageBps) : "ok";

      if (type === "EXACT_INPUT") {
        const usd = await tokenAmountUsd(tokenIn, BigInt(amountRaw));
        if (usd > 0) await checkSpendingCap(wallet, usd);
      }

      const tokenInAddr = getToken(tokenIn).native ? ZERO_ADDRESS : getToken(tokenIn).address;
      const tokenOutAddr = getToken(tokenOut).native ? ZERO_ADDRESS : getToken(tokenOut).address;
      const slippageTolerance = slippageBps !== undefined ? slippageBps / 100 : undefined;

      const quote = await fetchQuote({
        chainId: ACTIVE_CHAIN_ID,
        tokenIn: tokenInAddr,
        tokenOut: tokenOutAddr,
        amount: amountRaw,
        type,
        swapper: wallet,
        ...(slippageTolerance !== undefined ? { slippageTolerance } : {}),
      });

      res.json({ quote, slippageWarning });
    } catch (err) {
      if (err instanceof SafetyError) {
        await logAudit({
          ...ctx,
          action: "swap",
          outcome: err.code === "slippage_too_high" ? "rejected_slippage" : "rejected_cap",
          params: {
            tokenIn,
            tokenOut,
            amountRaw,
            type,
            ...(slippageBps !== undefined ? { slippageBps } : {}),
          },
          reason: err.message,
        });
        res.status(400).json({ error: err.message, code: err.code, details: err.details });
        return;
      }
      const message = err instanceof Error ? err.message : "Quote failed";
      await logAudit({
        ...ctx,
        action: "swap",
        outcome: "rejected_other",
        params: {
          tokenIn,
          tokenOut,
          amountRaw,
          type,
          ...(slippageBps !== undefined ? { slippageBps } : {}),
        },
        reason: message,
      });
      res
        .status(502)
        .json({ error: "Upstream quote failed", code: "UPSTREAM_QUOTE", details: message });
    }
  },
);
