import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  AnthropicUnavailableError,
  pageContextSchema,
  parseCommand,
} from "../lib/command-bar-nlp.ts";
import { logAudit } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

export const commandParseRouter = Router();

const requestSchema = z.object({
  text: z.string().min(1).max(2000),
  context: pageContextSchema,
});

/**
 * PN-003 — natural-language → structured-intent endpoint for the
 * Mantua command bar. Returns the parsed intent + cache metrics; the
 * caller drives confirmation + execution through the existing
 * `useConfirmedAction` seam (P1-005, PN-010).
 *
 * The CommandBar UI itself (PN-006) is deferred to TD-004; this route
 * is the data layer underneath.
 */
commandParseRouter.post(
  "/api/command/parse",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = requestSchema.safeParse(req.body);
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
      const result = await parseCommand(parsed.data.text, parsed.data.context);
      await logAudit({
        ...ctx,
        action: "command_parse",
        outcome: "success",
        params: {
          intentAction: result.intent.action,
          confidence: result.intent.confidence,
          model: result.model,
          page: parsed.data.context?.page ?? null,
          cacheReadInputTokens: result.cacheReadInputTokens,
          cacheCreationInputTokens: result.cacheCreationInputTokens,
        },
      });
      res.json(result);
    } catch (err) {
      if (err instanceof AnthropicUnavailableError) {
        res.status(503).json({ error: err.message, code: "ANTHROPIC_UNAVAILABLE" });
        return;
      }
      logger.error({ err }, "command parse failed");
      await logAudit({
        ...ctx,
        action: "command_parse",
        outcome: "failure",
        reason: err instanceof Error ? err.message : "unknown",
      });
      res.status(502).json({
        error: "Upstream NLP failure.",
        code: "UPSTREAM_FAILURE",
      });
    }
  },
);
