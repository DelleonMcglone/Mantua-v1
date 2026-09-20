import { Router, type Request, type Response } from "express";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { institutionMembers } from "../db/schema/institutions.ts";
import { logAudit } from "../lib/audit.ts";
import { canAssignRole, INSTITUTION_ROLES } from "../lib/custody/custody-roles.ts";
import { roleOf } from "../lib/custody/custody-store.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { allow, memberContext } from "./institution-context.ts";

/**
 * Task 074 / IC-002 — changing a member's role or removing them. The
 * owner role is the owner's alone to give or take, and an institution
 * keeps at least one active owner.
 */

export const institutionMembersPatchRouter = Router();

const patchSchema = z
  .object({
    role: z.enum(INSTITUTION_ROLES).optional(),
    status: z.enum(["active", "removed"]).optional(),
  })
  .strict();

institutionMembersPatchRouter.patch(
  "/api/institution/members/:id",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid patch", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const ctx = await memberContext(req, res);
    if (!ctx || !allow(ctx, "manage_members", res)) return;
    const target = (
      await db
        .select()
        .from(institutionMembers)
        .where(
          and(
            eq(institutionMembers.id, String(req.params["id"])),
            eq(institutionMembers.institutionId, ctx.institution.id),
          ),
        )
        .limit(1)
    ).at(0);
    if (!target) {
      res.status(404).json({ error: "No such member", code: "NOT_FOUND" });
      return;
    }
    const touchesOwner = roleOf(target) === "owner" || parsed.data.role === "owner";
    if (touchesOwner && !canAssignRole(ctx.role, "owner")) {
      res.status(403).json({ error: "Only an owner can change an owner.", code: "FORBIDDEN" });
      return;
    }
    const demotesOwner =
      roleOf(target) === "owner" &&
      ((parsed.data.role !== undefined && parsed.data.role !== "owner") ||
        parsed.data.status === "removed");
    if (demotesOwner) {
      const owners = await db
        .select({ n: count() })
        .from(institutionMembers)
        .where(
          and(
            eq(institutionMembers.institutionId, ctx.institution.id),
            eq(institutionMembers.role, "owner"),
            eq(institutionMembers.status, "active"),
          ),
        );
      if (owners[0].n <= 1) {
        res
          .status(409)
          .json({ error: "An institution keeps at least one owner.", code: "LAST_OWNER" });
        return;
      }
    }
    const row = (
      await db
        .update(institutionMembers)
        .set({ ...parsed.data, updatedAt: sql`now()` })
        .where(eq(institutionMembers.id, target.id))
        .returning()
    )[0];
    await logAudit({
      ...getRequestContext(req),
      action: "institution_member",
      outcome: "success",
      params: { institutionId: ctx.institution.id, memberId: row.id, patch: parsed.data },
    });
    res.json({ member: row });
  },
);
