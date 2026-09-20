import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { custodyDestinations } from "../db/schema/institutions.ts";
import { logAudit } from "../lib/audit.ts";
import { isSupportedChainId } from "../lib/chains.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { allow, memberContext, type MemberContext } from "./institution-context.ts";

/**
 * Task 073 / IC-001 — the withdrawal allowlist. An admin adds the
 * custodian's deposit address as `pending` and can revoke it; a
 * different member verifies it (`institution-destinations-verify.ts`).
 * Only a verified destination can receive a withdrawal.
 */

export const institutionDestinationsRouter = Router();

const addSchema = z.object({
  label: z.string().min(2).max(80),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().refine(isSupportedChainId, "Unsupported chainId").optional(),
});

export async function destinationFor(ctx: MemberContext, id: string) {
  return (
    await db
      .select()
      .from(custodyDestinations)
      .where(
        and(
          eq(custodyDestinations.id, id),
          eq(custodyDestinations.institutionId, ctx.institution.id),
        ),
      )
      .limit(1)
  ).at(0);
}

export async function auditDestination(
  req: Request,
  ctx: MemberContext,
  event: string,
  destinationId: string,
) {
  await logAudit({
    ...getRequestContext(req),
    action: "custody_destination",
    outcome: "success",
    params: { institutionId: ctx.institution.id, destinationId, event },
  });
}

institutionDestinationsRouter.post(
  "/api/institution/destinations",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid destination", code: "BAD_REQUEST", details: parsed.error.issues });
      return;
    }
    const ctx = await memberContext(req, res);
    if (!ctx || !allow(ctx, "manage_destinations", res)) return;
    const address = parsed.data.address.toLowerCase();
    const chainId = parsed.data.chainId ?? 8453;
    const duplicate = await db
      .select({ id: custodyDestinations.id })
      .from(custodyDestinations)
      .where(
        and(
          eq(custodyDestinations.institutionId, ctx.institution.id),
          eq(custodyDestinations.address, address),
          eq(custodyDestinations.chainId, chainId),
        ),
      )
      .limit(1);
    if (duplicate.length > 0) {
      res.status(409).json({ error: "That address is already listed.", code: "DUPLICATE" });
      return;
    }
    const row = (
      await db
        .insert(custodyDestinations)
        .values({
          institutionId: ctx.institution.id,
          label: parsed.data.label,
          address,
          chainId,
          addedBy: ctx.userId,
        })
        .returning()
    )[0];
    await auditDestination(req, ctx, "added", row.id);
    res.status(201).json({ destination: row });
  },
);

institutionDestinationsRouter.post(
  "/api/institution/destinations/:id/revoke",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const ctx = await memberContext(req, res);
    if (!ctx || !allow(ctx, "manage_destinations", res)) return;
    const dest = await destinationFor(ctx, String(req.params["id"]));
    if (!dest) {
      res.status(404).json({ error: "No such destination", code: "NOT_FOUND" });
      return;
    }
    const row = (
      await db
        .update(custodyDestinations)
        .set({ status: "revoked", revokedAt: sql`now()` })
        .where(eq(custodyDestinations.id, dest.id))
        .returning()
    )[0];
    await auditDestination(req, ctx, "revoked", row.id);
    res.json({ destination: row });
  },
);
