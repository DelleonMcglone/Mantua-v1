import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AgentWalletNotFoundError } from "../lib/agent-wallet.ts";
import { sendFromAgentWallet } from "../lib/agent-send.ts";
import { logAudit } from "../lib/audit.ts";
import { CircleUnavailableError } from "../lib/circle/client.ts";
import { SafetyError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { isTokenSymbol } from "../lib/tokens.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

export const agentSendRouter = Router();

const sendSchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "invalid address"),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal string"),
  token: z.string().refine(isTokenSymbol, "Unsupported token on this network"),
});

agentSendRouter.post(
  "/api/agent/send",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        code: "BAD_REQUEST",
        details: parsed.error.issues,
      });
      return;
    }
    const ctx = getRequestContext(req);
    const { to, amount, token } = parsed.data;
    try {
      const result = await sendFromAgentWallet({
        privyUserId,
        to: to as `0x${string}`,
        symbol: token,
        amount,
      });
      await logAudit({
        ...ctx,
        action: "agent_send",
        outcome: "success",
        txHash: result.txHash,
        params: {
          agentAddress: result.agentAddress,
          to,
          symbol: token,
          amountDecimal: amount,
          amountAtomic: result.amountAtomic,
          usdValue: result.usdValue,
          network: result.network,
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
      logger.error({ err }, "agent send failed");
      await logAudit({
        ...ctx,
        action: "agent_send",
        outcome: "failure",
        params: { to, symbol: token, amountDecimal: amount },
        reason: err instanceof Error ? err.message : "unknown",
      });
      // Upstream Circle / RPC errors land here.
      res.status(502).json({
        error: "Send failed at the upstream Circle/RPC layer.",
        code: "UPSTREAM_FAILURE",
      });
    }
  },
);
