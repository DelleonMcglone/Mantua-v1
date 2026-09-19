import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../env.ts";
import { type AgentChatEvent } from "../lib/agent-chat.ts";
import { logger } from "../lib/logger.ts";
import { transcriptTurnSchema } from "../lib/support/escalation.ts";
import {
  collectSupportReply,
  runSupportChat,
  type SupportAuth,
} from "../lib/support/support-chat.ts";
import { walletRateLimiter } from "../middleware/rate-limit.ts";

/**
 * Task 070 / AE-007 … AE-010 — the support agent's two channels.
 *
 *   POST /api/support/chat     SSE, same framing as the analyst and the
 *                              wallet agent so the client reader is shared
 *   POST /api/support/message  one JSON reply, for channels that cannot
 *                              stream (a bot, an email bridge, a widget)
 *
 * Both work anonymously with general help only; a Privy token upgrades the
 * turn with the caller's own account context. Rate-limited per wallet or
 * IP; 503 when the model is not configured.
 */
export const supportChatRouter = Router();

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(transcriptTurnSchema).max(20).optional(),
  channel: z
    .string()
    .regex(/^[a-z_]{2,16}$/)
    .optional(),
});

function authOf(req: Request): SupportAuth | null {
  return req.privyUserId
    ? { privyUserId: req.privyUserId, walletAddress: req.walletAddress }
    : null;
}

function parse(req: Request, res: Response): z.infer<typeof bodySchema> | null {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
    return null;
  }
  if (!env.ANTHROPIC_API_KEY) {
    res.status(503).json({
      error: "Support chat is unavailable (ANTHROPIC_API_KEY not configured).",
      code: "ANTHROPIC_UNAVAILABLE",
    });
    return null;
  }
  return parsed.data;
}

supportChatRouter.post(
  "/api/support/chat",
  walletRateLimiter,
  async (req: Request, res: Response) => {
    const body = parse(req, res);
    if (!body) return;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const write = (event: AgentChatEvent): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      for await (const event of runSupportChat({
        message: body.message,
        ...(body.history ? { history: body.history } : {}),
        channel: body.channel ?? "web",
        auth: authOf(req),
      })) {
        if (res.closed) break;
        write(event);
      }
    } catch (err) {
      logger.error({ err }, "support chat stream failed");
      if (!res.closed) write({ type: "error", message: "Support hit an unexpected error." });
    } finally {
      res.end();
    }
  },
);

supportChatRouter.post(
  "/api/support/message",
  walletRateLimiter,
  async (req: Request, res: Response) => {
    const body = parse(req, res);
    if (!body) return;
    try {
      const reply = await collectSupportReply({
        message: body.message,
        ...(body.history ? { history: body.history } : {}),
        channel: body.channel ?? "api",
        auth: authOf(req),
      });
      res.setHeader("Cache-Control", "private, no-store");
      res.json(reply);
    } catch (err) {
      logger.error({ err }, "support message failed");
      res.status(500).json({ error: "Support hit an unexpected error.", code: "INTERNAL" });
    }
  },
);
