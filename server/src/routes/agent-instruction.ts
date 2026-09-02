import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AnthropicUnavailableError, parseInstruction } from "../lib/agent-nlp.ts";
import { logAudit } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

export const agentInstructionRouter = Router();

const instructionSchema = z.object({
  text: z.string().min(1).max(2000),
});

/**
 * P6-010 — natural-language → structured-intent parser endpoint.
 *
 * Returns the parsed intent + the model + cache metrics. The caller is
 * responsible for executing the intent (typically by calling one of
 * the action endpoints from P6-003 → P6-008). Auto-execution wiring
 * is the autonomous-mode UI (P6-009), which is deferred to TD-004.
 */
agentInstructionRouter.post(
  "/api/agent/instruction",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = instructionSchema.safeParse(req.body);
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
      const result = await parseInstruction(parsed.data.text);
      await logAudit({
        ...ctx,
        action: "agent_instruction_parse",
        outcome: "success",
        params: {
          intentKind: result.intent.kind,
          model: result.model,
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
      logger.error({ err }, "agent instruction parse failed");
      await logAudit({
        ...ctx,
        action: "agent_instruction_parse",
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
