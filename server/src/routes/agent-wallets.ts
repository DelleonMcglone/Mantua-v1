import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AgentWallet } from "../db/schema/agent.ts";
import {
  AgentWalletNotFoundError,
  getAgentWallet,
  getOrCreateAgentWallet,
  updateAgentWalletCap,
  UserNotFoundError,
} from "../lib/agent-wallet.ts";
import { logAudit } from "../lib/audit.ts";
import { setAutoRebalance } from "../lib/agent-rebalance.ts";
import { CircleUnavailableError } from "../lib/circle/client.ts";
import { CustodyUnprovisionedError } from "../lib/custody/custody-wallet-set.ts";
import { HARD_DAILY_CAP_USD } from "../lib/constants.ts";
import { DEFAULT_CHAIN_ID, isSupportedChainId } from "../lib/chains.ts";
import { logger } from "../lib/logger.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { walletRateLimiter, writeRateLimiter } from "../middleware/rate-limit.ts";

export const agentWalletsRouter = Router();

interface AgentWalletDto {
  address: string;
  circleWalletId: string;
  label: string | null;
  dailyCapUsd: string;
  status: string;
  rebalanceEnabled: boolean;
  createdAt: string;
}

function toDto(w: AgentWallet): AgentWalletDto {
  return {
    address: w.address,
    circleWalletId: w.circleWalletId,
    label: w.label,
    dailyCapUsd: w.dailyCapUsd,
    status: w.status,
    rebalanceEnabled: w.rebalanceEnabled,
    createdAt: w.createdAt.toISOString(),
  };
}

agentWalletsRouter.post(
  "/api/agent/wallet",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const ctx = getRequestContext(req);
    const rawChain = Number((req.body as { chainId?: unknown } | undefined)?.chainId);
    const chainId = isSupportedChainId(rawChain) ? rawChain : DEFAULT_CHAIN_ID;
    try {
      const wallet = await getOrCreateAgentWallet(privyUserId, req.walletAddress, chainId);
      await logAudit({
        ...ctx,
        action: "agent_wallet_provision",
        outcome: "success",
        params: { agentAddress: wallet.address, circleWalletId: wallet.circleWalletId },
      });
      res.json(toDto(wallet));
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        res.status(409).json({
          error: "Connect your primary wallet first — no user record exists yet.",
          code: "USER_NOT_FOUND",
        });
        return;
      }
      if (err instanceof CircleUnavailableError) {
        res.status(503).json({ error: err.message, code: "CIRCLE_UNAVAILABLE" });
        return;
      }
      if (err instanceof CustodyUnprovisionedError) {
        res.status(409).json({ error: err.message, code: "CUSTODY_UNPROVISIONED" });
        return;
      }
      logger.error({ err }, "agent wallet provision failed");
      await logAudit({
        ...ctx,
        action: "agent_wallet_provision",
        outcome: "failure",
        reason: err instanceof Error ? err.message : "unknown",
      });
      res.status(500).json({ error: "Failed to provision agent wallet", code: "INTERNAL" });
    }
  },
);

agentWalletsRouter.get(
  "/api/agent/wallet",
  walletRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const wallet = await getAgentWallet(privyUserId);
    if (!wallet) {
      res.status(404).json({
        error: "No agent wallet provisioned for this user.",
        code: "NOT_FOUND",
      });
      return;
    }
    res.json(toDto(wallet));
  },
);

// 030 — `.positive()` matches the library clamp (`assertValidDailyCap`
// rejects 0), so a `dailyCapUsd: 0` PATCH fails cleanly at the boundary with
// the standard 400 envelope instead of surfacing the raw clamp error.
const updateCapSchema = z.object({
  dailyCapUsd: z.number().positive().max(HARD_DAILY_CAP_USD),
});

/**
 * P6-011 — set the agent wallet's daily USD spending cap. Per-wallet (not
 * per-user) by design, so the agent's blast radius is bounded
 * independently of the user's primary wallet cap (D-008 / P1-001).
 * The cap is enforced in `server/src/lib/spending-cap.ts:checkSpendingCap`
 * which already routes agent-wallet addresses through `agent_wallets`.
 * Range: 0 < dailyCapUsd ≤ HARD_DAILY_CAP_USD ($50k absolute ceiling
 * shared with the user wallet — set in code, not at runtime).
 */
agentWalletsRouter.patch(
  "/api/agent/wallet/cap",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = updateCapSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        code: "BAD_REQUEST",
        details: parsed.error.issues,
      });
      return;
    }
    const ctx = getRequestContext(req);
    try {
      const wallet = await updateAgentWalletCap(privyUserId, parsed.data.dailyCapUsd);
      await logAudit({
        ...ctx,
        action: "agent_wallet_cap_update",
        outcome: "success",
        params: { agentAddress: wallet.address, dailyCapUsd: wallet.dailyCapUsd },
      });
      res.json(toDto(wallet));
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        res.status(409).json({ error: err.message, code: "USER_NOT_FOUND" });
        return;
      }
      if (err instanceof AgentWalletNotFoundError) {
        res.status(404).json({ error: err.message, code: "AGENT_WALLET_NOT_FOUND" });
        return;
      }
      logger.error({ err }, "agent wallet cap update failed");
      await logAudit({
        ...ctx,
        action: "agent_wallet_cap_update",
        outcome: "failure",
        reason: err instanceof Error ? err.message : "unknown",
      });
      res.status(500).json({ error: "Failed to update agent wallet cap", code: "INTERNAL" });
    }
  },
);

const rebalanceSchema = z.object({ enabled: z.boolean() });

/**
 * PATCH /api/agent/rebalance — opt the agent wallet in/out of autonomous peg
 * de-peg-exit rebalancing (Phase 2). Defaults off.
 */
agentWalletsRouter.patch(
  "/api/agent/rebalance",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = rebalanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    try {
      const wallet = await setAutoRebalance(privyUserId, parsed.data.enabled);
      res.json(toDto(wallet));
    } catch (err) {
      if (err instanceof AgentWalletNotFoundError) {
        res.status(404).json({ error: err.message, code: "AGENT_WALLET_NOT_FOUND" });
        return;
      }
      logger.error({ err }, "agent rebalance toggle failed");
      res.status(500).json({ error: "Failed to update rebalance setting", code: "INTERNAL" });
    }
  },
);
