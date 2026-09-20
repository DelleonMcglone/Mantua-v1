import { Router, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { institutions } from "../db/schema/institutions.ts";
import { logAudit } from "../lib/audit.ts";
import { CircleUnavailableError } from "../lib/circle/client.ts";
import { institutionById } from "../lib/custody/custody-store.ts";
import { provisionInstitutionWalletSet } from "../lib/custody/custody-wallet-set.ts";
import { logger } from "../lib/logger.ts";
import { requireOpsAuth } from "../middleware/ops-auth.ts";
import { money, patchInstitutionSchema } from "./ops-institutions-schema.ts";

/**
 * Task 073 / IC-001, IC-002 — the operator provisions an institution's
 * Circle wallet set (which activates a pending institution) and adjusts
 * its status, name and limits. Behind `MANTUA_OPS_KEY`.
 */

export const opsInstitutionsManageRouter = Router();

opsInstitutionsManageRouter.post(
  "/api/ops/institutions/:id/provision",
  requireOpsAuth,
  async (req: Request, res: Response) => {
    const inst = await institutionById(db, String(req.params["id"]));
    if (!inst) {
      res.status(404).json({ error: "No such institution", code: "NOT_FOUND" });
      return;
    }
    try {
      const provisioned = await provisionInstitutionWalletSet(db, inst);
      await logAudit({
        action: "institution_update",
        outcome: "success",
        params: {
          institutionId: inst.id,
          event: "provisioned",
          walletSetId: provisioned.circleWalletSetId,
        },
      });
      res.json({ institution: provisioned });
    } catch (err) {
      if (err instanceof CircleUnavailableError) {
        res.status(503).json({ error: err.message, code: "CIRCLE_UNAVAILABLE" });
        return;
      }
      logger.error({ err }, "ops: wallet set provisioning failed");
      res
        .status(502)
        .json({ error: "Couldn't provision the wallet set.", code: "PROVISION_FAILED" });
    }
  },
);

opsInstitutionsManageRouter.patch(
  "/api/ops/institutions/:id",
  requireOpsAuth,
  async (req: Request, res: Response) => {
    const parsed = patchInstitutionSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid patch", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const { dailyCapUsd, perTradeCapUsd, approvalThresholdUsd, ...rest } = parsed.data;
    const rows = await db
      .update(institutions)
      .set({
        ...rest,
        dailyCapUsd: money(dailyCapUsd),
        perTradeCapUsd: money(perTradeCapUsd),
        approvalThresholdUsd: money(approvalThresholdUsd),
        updatedAt: sql`now()`,
      })
      .where(eq(institutions.id, String(req.params["id"])))
      .returning();
    const inst = rows.at(0);
    if (!inst) {
      res.status(404).json({ error: "No such institution", code: "NOT_FOUND" });
      return;
    }
    await logAudit({
      action: "institution_update",
      outcome: "success",
      params: { institutionId: inst.id, patch: parsed.data },
    });
    res.json({ institution: inst });
  },
);
