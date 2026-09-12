import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { policyPatchSchema, readPolicy, updatePolicy } from "../lib/agent/policy.ts";
import { logAudit } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { resolveUserId } from "../lib/sports/strategy-store.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

/**
 * Phase 8 / A-003, A-012 (D-109) — the user's policy over their agent.
 *
 *   GET   /api/agent/policy  → the view (defaults when no row exists)
 *   PATCH /api/agent/policy  → validated partial update, audited
 *
 * The ONLY write path: the agent has `mantua_get_policy` and no write tool,
 * so a prompt cannot widen the agent's limits. Values clamp in the schema
 * (per-trade and hedge ceilings ≤ HARD_DAILY_CAP_USD).
 */
export const agentPolicyRouter = Router();

agentPolicyRouter.get("/api/agent/policy", requireAuth, async (req: Request, res: Response) => {
  const privyUserId = req.privyUserId;
  if (!privyUserId) {
    res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
    return;
  }
  try {
    const userId = await resolveUserId(db, privyUserId);
    if (!userId) {
      res.status(409).json({ error: "User record not found.", code: "USER_NOT_FOUND" });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await readPolicy(db, userId));
  } catch (err) {
    logger.error({ err }, "agent policy read failed");
    res.status(500).json({ error: "Failed to load agent policy", code: "INTERNAL" });
  }
});

agentPolicyRouter.patch(
  "/api/agent/policy",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = policyPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const ctx = getRequestContext(req);
    try {
      const userId = await resolveUserId(db, privyUserId);
      if (!userId) {
        res.status(409).json({ error: "User record not found.", code: "USER_NOT_FOUND" });
        return;
      }
      const view = await updatePolicy(db, userId, parsed.data);
      await logAudit({
        ...ctx,
        action: "agent_policy_update",
        outcome: "success",
        params: { patch: parsed.data, policy: view },
      });
      res.json(view);
    } catch (err) {
      logger.error({ err }, "agent policy update failed");
      await logAudit({
        ...ctx,
        action: "agent_policy_update",
        outcome: "failure",
        reason: err instanceof Error ? err.message : "unknown",
      });
      res.status(500).json({ error: "Failed to update agent policy", code: "INTERNAL" });
    }
  },
);
