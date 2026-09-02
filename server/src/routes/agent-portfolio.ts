import { Router, type Request, type Response } from "express";
import { getAgentPortfolio } from "../lib/agent-portfolio.ts";
import { DEFAULT_CHAIN_ID, isSupportedChainId } from "../lib/chains.ts";
import { AgentWalletNotFoundError } from "../lib/agent-wallet.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { walletRateLimiter } from "../middleware/rate-limit.ts";

export const agentPortfolioRouter = Router();

agentPortfolioRouter.get(
  "/api/agent/portfolio",
  walletRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const rawChain = Number(req.query.chainId);
    const chainId = isSupportedChainId(rawChain) ? rawChain : DEFAULT_CHAIN_ID;
    try {
      const portfolio = await getAgentPortfolio(privyUserId, 50, chainId);
      res.json(portfolio);
    } catch (err) {
      if (err instanceof AgentWalletNotFoundError) {
        res.status(404).json({ error: err.message, code: "AGENT_WALLET_NOT_FOUND" });
        return;
      }
      logger.error({ err }, "agent portfolio fetch failed");
      res.status(502).json({
        error: "Failed to load agent portfolio",
        code: "UPSTREAM_FAILURE",
      });
    }
  },
);
