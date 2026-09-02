import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../env.ts";
import { runAgentChat, type AgentChatEvent } from "../lib/agent-chat.ts";
import { isSupportedChainId } from "../lib/chains.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

export const agentChatRouter = Router();

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  sessionId: z.uuid().optional(),
  /** The user's selected chain; omitted means Base (back-compat). */
  chainId: z.number().int().refine(isSupportedChainId, "Unsupported chainId").optional(),
});

/**
 * Conversational autonomous agent endpoint (Server-Sent Events).
 *
 * Streams `AgentChatEvent`s as `data:` lines: a `session` id, assistant `text`
 * deltas, `tool_start` / `tool_result` step events (which the UI renders as
 * live status + result cards), and a terminal `done`. Tools execute inline on
 * the server's Circle wallet with no confirmation — the daily spending cap is
 * the guardrail.
 */
agentChatRouter.post(
  "/api/agent/chat",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    if (!env.ANTHROPIC_API_KEY) {
      res.status(503).json({
        error: "Agent is unavailable (ANTHROPIC_API_KEY not configured).",
        code: "ANTHROPIC_UNAVAILABLE",
      });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering so events flush immediately (nginx / Vercel).
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const write = (event: AgentChatEvent): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // `res.closed` flips to true if the client disconnects mid-stream. Reading
    // the property (rather than a local flag set in a callback) keeps the
    // checks honest to eslint's flow analysis and stops us writing to a dead
    // socket / running the agent loop for a client that's gone.
    try {
      for await (const event of runAgentChat({
        privyUserId,
        walletAddress: req.walletAddress,
        sessionId: parsed.data.sessionId,
        message: parsed.data.message,
        chainId: parsed.data.chainId,
      })) {
        if (res.closed) break;
        write(event);
      }
    } catch (err) {
      logger.error({ err }, "agent chat stream failed");
      if (!res.closed) write({ type: "error", message: "The agent hit an unexpected error." });
    } finally {
      res.end();
    }
  },
);
