import { Router, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { custodyDestinations } from "../db/schema/institutions.ts";
import { canVerifyDestination } from "../lib/custody/custody-roles.ts";
import { memberView } from "../lib/custody/custody-store.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { memberContext } from "./institution-context.ts";
import { auditDestination, destinationFor } from "./institution-destinations.ts";

/**
 * Task 074 / IC-001 — the second pair of eyes on a destination: a member
 * with `verify_destination` who is not the adder turns `pending` into
 * `verified`. Until then no withdrawal can go there.
 */

export const institutionDestinationsVerifyRouter = Router();

institutionDestinationsVerifyRouter.post(
  "/api/institution/destinations/:id/verify",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const ctx = await memberContext(req, res);
    if (!ctx) return;
    const dest = await destinationFor(ctx, String(req.params["id"]));
    if (!dest) {
      res.status(404).json({ error: "No such destination", code: "NOT_FOUND" });
      return;
    }
    const dual = canVerifyDestination(memberView(ctx.member), { addedBy: dest.addedBy });
    if (!dual.ok) {
      res.status(403).json({
        error: "A different member with verification rights must verify.",
        code: "DUAL_CONTROL",
        details: { reason: dual.reason },
      });
      return;
    }
    if (dest.status !== "pending") {
      res.status(409).json({ error: `The destination is ${dest.status}.`, code: "NOT_PENDING" });
      return;
    }
    const row = (
      await db
        .update(custodyDestinations)
        .set({ status: "verified", verifiedBy: ctx.userId, verifiedAt: sql`now()` })
        .where(eq(custodyDestinations.id, dest.id))
        .returning()
    )[0];
    await auditDestination(req, ctx, "verified", row.id);
    res.json({ destination: row });
  },
);
