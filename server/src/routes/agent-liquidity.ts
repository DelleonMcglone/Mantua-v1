import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  addLiquidityFromAgentWallet,
  removeLiquidityFromAgentWallet,
} from "../lib/agent-liquidity.ts";
import { AgentWalletNotFoundError } from "../lib/agent-wallet.ts";
import { logAudit } from "../lib/audit.ts";
import { CircleUnavailableError } from "../lib/circle/client.ts";
import { SafetyError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { isTokenSymbol } from "../lib/tokens.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

export const agentLiquidityRouter = Router();

const FEE_TIERS = [100, 500, 3000, 10_000] as const;

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal string");

const addSchema = z.object({
  tokenA: z.string().refine(isTokenSymbol, "Unsupported tokenA"),
  tokenB: z.string().refine(isTokenSymbol, "Unsupported tokenB"),
  fee: z
    .number()
    .refine((n) => (FEE_TIERS as readonly number[]).includes(n), "Unsupported fee tier"),
  amountA: decimalString,
  amountB: decimalString,
  slippageBps: z.number().int().min(0).max(500).default(50),
  /** Unix-seconds deadline. Defaults to now + 30 minutes. */
  deadlineSeconds: z.number().int().positive().optional(),
});

const removeSchema = z.object({
  positionId: z.uuid(),
  percentage: z.number().int().min(1).max(100),
  slippageBps: z.number().int().min(0).max(500).default(50),
  deadlineSeconds: z.number().int().positive().optional(),
});

function thirtyMinutesFromNow(): number {
  return Math.floor(Date.now() / 1000) + 30 * 60;
}

agentLiquidityRouter.post(
  "/api/agent/liquidity/add",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        code: "BAD_REQUEST",
        details: parsed.error.issues,
      });
      return;
    }
    const ctx = getRequestContext(req);
    const v = parsed.data;
    try {
      const result = await addLiquidityFromAgentWallet({
        privyUserId,
        tokenA: v.tokenA,
        tokenB: v.tokenB,
        fee: v.fee as 100 | 500 | 3000 | 10_000,
        amountA: v.amountA,
        amountB: v.amountB,
        slippageBps: v.slippageBps,
        deadlineSeconds: v.deadlineSeconds ?? thirtyMinutesFromNow(),
      });
      await logAudit({
        ...ctx,
        action: "agent_add_liquidity",
        outcome: "success",
        txHash: result.txHash,
        params: {
          agentAddress: result.agentAddress,
          tokenA: v.tokenA,
          tokenB: v.tokenB,
          amountARaw: result.amountARaw,
          amountBRaw: result.amountBRaw,
          tokenId: result.tokenId,
          poolKeyHash: result.poolKeyHash,
          usdValue: result.usdValue,
        },
      });
      res.json(result);
    } catch (err) {
      if (err instanceof AgentWalletNotFoundError) {
        res.status(404).json({ error: err.message, code: "AGENT_WALLET_NOT_FOUND" });
        return;
      }
      if (err instanceof SafetyError) {
        res.status(403).json({ error: err.message, code: err.code, details: err.details });
        return;
      }
      if (err instanceof CircleUnavailableError) {
        res.status(503).json({ error: err.message, code: "CIRCLE_UNAVAILABLE" });
        return;
      }
      logger.error({ err }, "agent add-liquidity failed");
      await logAudit({
        ...ctx,
        action: "agent_add_liquidity",
        outcome: "failure",
        params: { tokenA: v.tokenA, tokenB: v.tokenB },
        reason: err instanceof Error ? err.message : "unknown",
      });
      const message = err instanceof Error ? err.message : "unknown";
      res.status(502).json({
        error: `Add-liquidity failed at the upstream layer: ${message}`,
        code: "UPSTREAM_FAILURE",
      });
    }
  },
);

agentLiquidityRouter.post(
  "/api/agent/liquidity/remove",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = removeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        code: "BAD_REQUEST",
        details: parsed.error.issues,
      });
      return;
    }
    const ctx = getRequestContext(req);
    const v = parsed.data;
    try {
      const result = await removeLiquidityFromAgentWallet({
        privyUserId,
        positionId: v.positionId,
        percentage: v.percentage,
        slippageBps: v.slippageBps,
        deadlineSeconds: v.deadlineSeconds ?? thirtyMinutesFromNow(),
      });
      await logAudit({
        ...ctx,
        action: "agent_remove_liquidity",
        outcome: "success",
        txHash: result.txHash,
        params: {
          agentAddress: result.agentAddress,
          positionId: v.positionId,
          percentage: v.percentage,
          liquidityRemoved: result.liquidityRemoved,
          isFullExit: result.isFullExit,
        },
      });
      res.json(result);
    } catch (err) {
      if (err instanceof AgentWalletNotFoundError) {
        res.status(404).json({ error: err.message, code: "AGENT_WALLET_NOT_FOUND" });
        return;
      }
      if (err instanceof CircleUnavailableError) {
        res.status(503).json({ error: err.message, code: "CIRCLE_UNAVAILABLE" });
        return;
      }
      logger.error({ err }, "agent remove-liquidity failed");
      await logAudit({
        ...ctx,
        action: "agent_remove_liquidity",
        outcome: "failure",
        params: { positionId: v.positionId, percentage: v.percentage },
        reason: err instanceof Error ? err.message : "unknown",
      });
      const message = err instanceof Error ? err.message : "unknown";
      res.status(502).json({
        error: `Remove-liquidity failed at the upstream layer: ${message}`,
        code: "UPSTREAM_FAILURE",
      });
    }
  },
);
