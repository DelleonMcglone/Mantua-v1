import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { institutionMembers, institutions } from "../db/schema/institutions.ts";
import { users } from "../db/schema/users.ts";
import { logAudit } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { requireOpsAuth } from "../middleware/ops-auth.ts";
import { createInstitutionSchema, money } from "./ops-institutions-schema.ts";

/**
 * Task 074 / IC-002 — operator onboarding of an institution: list them,
 * create one with its first owner. Provisioning and limits live in
 * `ops-institutions-manage.ts`. Behind `MANTUA_OPS_KEY`.
 */

export const opsInstitutionsRouter = Router();

opsInstitutionsRouter.get("/api/ops/institutions", requireOpsAuth, async (_req, res) => {
  res.json({ institutions: await db.select().from(institutions) });
});

opsInstitutionsRouter.post(
  "/api/ops/institutions",
  requireOpsAuth,
  async (req: Request, res: Response) => {
    const parsed = createInstitutionSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid institution", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const { ownerAddress, dailyCapUsd, perTradeCapUsd, approvalThresholdUsd, ...fields } =
      parsed.data;
    const owner = (
      await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.primaryAddress, ownerAddress.toLowerCase()))
        .limit(1)
    ).at(0);
    if (!owner) {
      res
        .status(404)
        .json({ error: "No user with that wallet has signed in yet.", code: "USER_NOT_FOUND" });
      return;
    }
    try {
      const created = await db.transaction(async (tx) => {
        const inst = (
          await tx
            .insert(institutions)
            .values({
              ...fields,
              dailyCapUsd: money(dailyCapUsd),
              perTradeCapUsd: money(perTradeCapUsd),
              approvalThresholdUsd: money(approvalThresholdUsd),
            })
            .returning()
        )[0];
        await tx
          .insert(institutionMembers)
          .values({ institutionId: inst.id, userId: owner.id, role: "owner" });
        return inst;
      });
      await logAudit({
        action: "institution_update",
        outcome: "success",
        params: { institutionId: created.id, event: "created" },
      });
      res.status(201).json({ institution: created });
    } catch (err) {
      logger.warn({ err }, "ops: institution create failed");
      res.status(409).json({
        error: "Slug taken or the owner already belongs to an institution.",
        code: "CONFLICT",
      });
    }
  },
);
