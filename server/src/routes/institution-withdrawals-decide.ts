import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { custodyWithdrawals } from "../db/schema/institutions.ts";
import { logAudit } from "../lib/audit.ts";
import { decideWithdrawal } from "../lib/custody/custody-withdrawals.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { allow, memberContext } from "./institution-context.ts";
import {
  respondWithdrawal,
  withdrawalAuditFor,
  withdrawalFailure,
} from "./institution-withdrawal-respond.ts";

/**
 * Task 074 / IC-001 — the decision on a pending withdrawal (approve or
 * reject, by a second member) and the requester's own cancellation.
 */

export const institutionWithdrawalsDecideRouter = Router();

const decideSchema = z.object({ approve: z.boolean(), reason: z.string().max(280).optional() });

institutionWithdrawalsDecideRouter.post(
  "/api/institution/withdrawals/:id/decide",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = decideSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid decision", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const ctx = await memberContext(req, res);
    if (!ctx || !allow(ctx, "approve_withdrawal", res)) return;
    try {
      respondWithdrawal(
        res,
        await decideWithdrawal(db, {
          id: String(req.params["id"]),
          actorUserId: ctx.userId,
          approve: parsed.data.approve,
          ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
          audit: withdrawalAuditFor(req),
        }),
      );
    } catch (err) {
      withdrawalFailure(res, err, "DECIDE_FAILED", "decide the withdrawal");
    }
  },
);

institutionWithdrawalsDecideRouter.post(
  "/api/institution/withdrawals/:id/cancel",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const ctx = await memberContext(req, res);
    if (!ctx) return;
    const row = (
      await db
        .update(custodyWithdrawals)
        .set({
          status: "cancelled",
          decidedBy: ctx.userId,
          decidedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(custodyWithdrawals.id, String(req.params["id"])),
            eq(custodyWithdrawals.institutionId, ctx.institution.id),
            eq(custodyWithdrawals.requestedBy, ctx.userId),
            eq(custodyWithdrawals.status, "pending"),
          ),
        )
        .returning()
    ).at(0);
    if (!row) {
      res
        .status(409)
        .json({ error: "Only your own pending request can be cancelled.", code: "NOT_PENDING" });
      return;
    }
    await logAudit({
      ...getRequestContext(req),
      action: "custody_withdrawal",
      outcome: "rejected_other",
      reason: "cancelled",
      params: { withdrawalId: row.id },
    });
    res.json({ withdrawal: row });
  },
);
