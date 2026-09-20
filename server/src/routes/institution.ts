import { Router, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { agentWallets } from "../db/schema/agent.ts";
import { custodyDestinations, type Institution } from "../db/schema/institutions.ts";
import { users } from "../db/schema/users.ts";
import { logAudit } from "../lib/audit.ts";
import { BASE_CHAIN_ID } from "../lib/chains.ts";
import { CircleUnavailableError } from "../lib/circle/client.ts";
import { limitsOf, membersOf } from "../lib/custody/custody-store.ts";
import { segregateAgentWallet } from "../lib/custody/custody-wallet-set.ts";
import { logger } from "../lib/logger.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { allow, memberContext } from "./institution-context.ts";

/**
 * Task 073 / IC-002 — the member's view of their institution and the one
 * self-service write: moving their agent wallet into the institution's
 * custody wallet set (IC-001).
 */

export const institutionRouter = Router();

function publicInstitution(i: Institution) {
  return {
    id: i.id,
    slug: i.slug,
    name: i.name,
    status: i.status,
    custodian: i.custodian,
    custodianLabel: i.custodianLabel,
    provisioned: i.circleWalletSetId !== null,
    limits: limitsOf(i),
  };
}

institutionRouter.get("/api/institution", requireAuth, async (req: Request, res: Response) => {
  const ctx = await memberContext(req, res);
  if (!ctx) return;
  try {
    const setId = ctx.institution.circleWalletSetId;
    const [wallet, destinations, members] = await Promise.all([
      db
        .select()
        .from(agentWallets)
        .where(and(eq(agentWallets.userId, ctx.userId), eq(agentWallets.blockchain, "BASE")))
        .limit(1)
        .then((rows) => rows.at(0) ?? null),
      db
        .select()
        .from(custodyDestinations)
        .where(eq(custodyDestinations.institutionId, ctx.institution.id)),
      ctx.permissions.includes("manage_members")
        ? membersOf(db, ctx.institution.id).then(async (rows) => {
            const ids = rows.map((m) => m.userId);
            const people = ids.length
              ? await db
                  .select({ id: users.id, address: users.primaryAddress, email: users.email })
                  .from(users)
                  .where(inArray(users.id, ids))
              : [];
            const byId = new Map(people.map((p) => [p.id, p]));
            return rows.map((m) => ({
              id: m.id,
              userId: m.userId,
              role: m.role,
              status: m.status,
              address: byId.get(m.userId)?.address ?? null,
              email: byId.get(m.userId)?.email ?? null,
              since: m.createdAt.toISOString(),
            }));
          })
        : Promise.resolve(null),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      institution: publicInstitution(ctx.institution),
      me: { userId: ctx.userId, role: ctx.role, permissions: ctx.permissions },
      wallet: wallet
        ? { address: wallet.address, segregated: setId !== null && wallet.walletSetId === setId }
        : null,
      destinations: destinations.map((d) => ({
        id: d.id,
        label: d.label,
        address: d.address,
        chainId: d.chainId,
        status: d.status,
        addedBy: d.addedBy,
        verifiedBy: d.verifiedBy,
      })),
      members,
    });
  } catch (err) {
    logger.warn({ err }, "institution: read failed");
    res.status(500).json({ error: "Failed to load the institution", code: "INTERNAL" });
  }
});

institutionRouter.post(
  "/api/institution/wallet/segregate",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const ctx = await memberContext(req, res);
    if (!ctx || !allow(ctx, "trade", res)) return;
    try {
      const result = await segregateAgentWallet(db, { userId: ctx.userId, chainId: BASE_CHAIN_ID });
      await logAudit({
        ...getRequestContext(req),
        action: "agent_wallet_provision",
        outcome:
          result.kind === "not_empty" || result.kind === "unprovisioned"
            ? "rejected_other"
            : "success",
        params: { institutionId: ctx.institution.id, segregate: result },
      });
      const status =
        result.kind === "unprovisioned" ? 503 : result.kind === "not_empty" ? 409 : 200;
      res.status(status).json(result);
    } catch (err) {
      if (err instanceof CircleUnavailableError) {
        res.status(503).json({ error: err.message, code: "CIRCLE_UNAVAILABLE" });
        return;
      }
      logger.error({ err }, "institution: wallet segregation failed");
      res.status(502).json({ error: "Couldn't move the wallet.", code: "SEGREGATE_FAILED" });
    }
  },
);
