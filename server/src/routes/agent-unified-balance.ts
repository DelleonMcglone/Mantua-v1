import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
import { CircleUnavailableError } from "../lib/circle/client.ts";
import {
  getUnifiedBalances,
  depositToUnifiedBalance,
  spendUnifiedBalance,
  UnifiedBalanceUnavailableError,
  GATEWAY_SPEND_CHAINS,
} from "../lib/unified-balance.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

export const agentUnifiedBalanceRouter = Router();

/**
 * GET /api/agent/unified-balance — the agent wallet's consolidated USDC balance
 * across chains (Circle Gateway). Returns `{ provisioned: false }` if the user
 * has no agent wallet yet.
 */
agentUnifiedBalanceRouter.get(
  "/api/agent/unified-balance",
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    try {
      res.json(await getUnifiedBalances(privyUserId));
    } catch (err) {
      if (err instanceof CircleUnavailableError || err instanceof UnifiedBalanceUnavailableError) {
        res.status(503).json({ error: err.message, code: "UNIFIED_BALANCE_UNAVAILABLE" });
        return;
      }
      logger.error({ err }, "unified-balance read failed");
      res.status(502).json({
        error: "Couldn't read the unified balance from Circle.",
        code: "UPSTREAM_FAILURE",
      });
    }
  },
);

const depositSchema = z.object({
  amount: z
    .string()
    .regex(/^\d*\.?\d+$/, "amount must be a positive decimal")
    .refine((s) => Number(s) > 0, "amount must be > 0"),
});

/**
 * POST /api/agent/unified-balance/deposit — deposit USDC from the agent wallet
 * (on Base) into its unified balance. Provisions the agent wallet on demand.
 */
agentUnifiedBalanceRouter.post(
  "/api/agent/unified-balance/deposit",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = depositSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    try {
      const result = await depositToUnifiedBalance(
        privyUserId,
        req.walletAddress,
        parsed.data.amount,
      );
      res.json(result);
    } catch (err) {
      if (err instanceof CircleUnavailableError || err instanceof UnifiedBalanceUnavailableError) {
        res.status(503).json({ error: err.message, code: "UNIFIED_BALANCE_UNAVAILABLE" });
        return;
      }
      logger.error({ err }, "unified-balance deposit failed");
      res.status(502).json({
        error: "Deposit failed at the upstream Circle layer.",
        code: "UPSTREAM_FAILURE",
      });
    }
  },
);

const spendSchema = z.object({
  amount: z
    .string()
    .regex(/^\d*\.?\d+$/, "amount must be a positive decimal")
    .refine((s) => Number(s) > 0, "amount must be > 0"),
  destinationChain: z.enum(GATEWAY_SPEND_CHAINS),
  recipientAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "recipientAddress must be a 0x EVM address")
    .optional(),
});

/**
 * POST /api/agent/unified-balance/spend — settle USDC from the agent's
 * unified balance (deposited on Base) to another Gateway chain. Signed by the
 * admin-EOA delegate; the first call may return `delegate_pending` while
 * Gateway finalizes the delegate registration.
 */
agentUnifiedBalanceRouter.post(
  "/api/agent/unified-balance/spend",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = spendSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    try {
      res.json(await spendUnifiedBalance(privyUserId, parsed.data));
    } catch (err) {
      if (err instanceof CircleUnavailableError || err instanceof UnifiedBalanceUnavailableError) {
        res.status(503).json({ error: err.message, code: "UNIFIED_BALANCE_UNAVAILABLE" });
        return;
      }
      logger.error({ err }, "unified-balance spend failed");
      res.status(502).json({
        error: "Spend failed at the upstream Circle layer.",
        code: "UPSTREAM_FAILURE",
      });
    }
  },
);
