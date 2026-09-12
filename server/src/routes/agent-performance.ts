import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { readAgentPerformance } from "../lib/agent/performance.ts";
import { getAgentWallet } from "../lib/agent-wallet.ts";
import { DEFAULT_CHAIN_ID } from "../lib/chains.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";

/**
 * Phase 8 / A-016 — GET /api/agent/performance: the agent wallet's realized
 * P&L, win rate and per-market ledger from indexed fills and resolutions.
 */
export const agentPerformanceRouter = Router();

agentPerformanceRouter.get(
  "/api/agent/performance",
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    try {
      const wallet = await getAgentWallet(privyUserId, DEFAULT_CHAIN_ID);
      if (!wallet) {
        res
          .status(404)
          .json({ error: "No agent wallet provisioned.", code: "AGENT_WALLET_NOT_FOUND" });
        return;
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.json(await readAgentPerformance(db, wallet.address));
    } catch (err) {
      logger.error({ err }, "agent performance read failed");
      res.status(500).json({ error: "Failed to load agent performance", code: "INTERNAL" });
    }
  },
);
