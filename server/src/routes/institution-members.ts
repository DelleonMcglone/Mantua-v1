import { Router, type Request, type Response } from "express";
import { eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { institutionMembers } from "../db/schema/institutions.ts";
import { users } from "../db/schema/users.ts";
import { logAudit } from "../lib/audit.ts";
import { canAssignRole, INSTITUTION_ROLES } from "../lib/custody/custody-roles.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { allow, memberContext } from "./institution-context.ts";

/**
 * Task 074 / IC-002 — adding a member: an admin names a user (by wallet
 * or email) and a role. A removed member of this institution is
 * re-activated; a member of another institution is refused (one
 * institution per user). Role changes and removals live in
 * `institution-members-patch.ts`.
 */

export const institutionMembersRouter = Router();

const addSchema = z
  .object({
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
    email: z.email().optional(),
    role: z.enum(INSTITUTION_ROLES),
  })
  .refine((v) => v.address !== undefined || v.email !== undefined, "address or email required");

institutionMembersRouter.post(
  "/api/institution/members",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid member", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const ctx = await memberContext(req, res);
    if (!ctx || !allow(ctx, "manage_members", res)) return;
    if (!canAssignRole(ctx.role, parsed.data.role)) {
      res.status(403).json({ error: "Only an owner can grant the owner role.", code: "FORBIDDEN" });
      return;
    }
    const { address, email } = parsed.data;
    const user = (
      await db
        .select({ id: users.id })
        .from(users)
        .where(
          or(
            address ? eq(users.primaryAddress, address.toLowerCase()) : sql`false`,
            email ? eq(users.email, email) : sql`false`,
          ),
        )
        .limit(1)
    ).at(0);
    if (!user) {
      res.status(404).json({
        error: "No user with that wallet or email has signed in yet.",
        code: "USER_NOT_FOUND",
      });
      return;
    }
    const existing = (
      await db
        .select()
        .from(institutionMembers)
        .where(eq(institutionMembers.userId, user.id))
        .limit(1)
    ).at(0);
    if (existing?.status === "active") {
      res
        .status(409)
        .json({ error: "That user already belongs to an institution.", code: "ALREADY_MEMBER" });
      return;
    }
    // A removed member (of this or another institution) is re-homed here.
    const row = existing
      ? (
          await db
            .update(institutionMembers)
            .set({
              institutionId: ctx.institution.id,
              role: parsed.data.role,
              status: "active",
              addedBy: ctx.userId,
              updatedAt: sql`now()`,
            })
            .where(eq(institutionMembers.id, existing.id))
            .returning()
        )[0]
      : (
          await db
            .insert(institutionMembers)
            .values({
              institutionId: ctx.institution.id,
              userId: user.id,
              role: parsed.data.role,
              addedBy: ctx.userId,
            })
            .returning()
        )[0];
    await logAudit({
      ...getRequestContext(req),
      action: "institution_member",
      outcome: "success",
      params: {
        institutionId: ctx.institution.id,
        memberId: row.id,
        role: row.role,
        event: "added",
      },
    });
    res.status(201).json({ member: row });
  },
);
