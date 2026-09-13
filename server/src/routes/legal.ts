import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { legalAcceptances } from "../db/schema/legal.ts";
import { dbFiatStore } from "../lib/fiat-store.ts";
import {
  CURRENT_VERSIONS,
  LEGAL_DOCS,
  acceptanceStatus,
  isLegalDoc,
  type AcceptanceRow,
  type LegalDoc,
} from "../lib/legal.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

export interface LegalRouteDeps {
  ensureUser: (privyUserId: string) => Promise<string>;
  list: (userId: string) => Promise<AcceptanceRow[]>;
  record: (userId: string, doc: LegalDoc, version: string) => Promise<void>;
}

const acceptSchema = z.object({
  doc: z.string().refine(isLegalDoc, "Unknown document"),
  version: z.string().min(1).max(16),
});

/**
 * Task 067 (G-014) — recorded legal acceptance.
 *
 * GET  /api/legal/acceptance — the signed-in user's standing against every
 *      document's current version (the ticket reads `terms.current`).
 * POST /api/legal/acceptance — record acceptance of the CURRENT version of
 *      one document; an older version is refused (409) so a stale client
 *      cannot record consent to text the user never saw.
 */
export function createLegalRouter(overrides: Partial<LegalRouteDeps> = {}): Router {
  const deps: LegalRouteDeps = {
    ensureUser: overrides.ensureUser ?? ((id) => dbFiatStore.ensureUser(id)),
    list:
      overrides.list ??
      (async (userId) =>
        db
          .select({
            doc: legalAcceptances.doc,
            version: legalAcceptances.version,
            acceptedAt: legalAcceptances.acceptedAt,
          })
          .from(legalAcceptances)
          .where(eq(legalAcceptances.userId, userId))),
    record:
      overrides.record ??
      (async (userId, doc, version) => {
        await db.insert(legalAcceptances).values({ userId, doc, version }).onConflictDoNothing();
      }),
  };
  const router = Router();

  router.get("/api/legal/acceptance", requireAuth, async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId ?? "";
    try {
      const userId = await deps.ensureUser(privyUserId);
      const rows = await deps.list(userId);
      const out: Record<string, unknown> = {};
      for (const doc of LEGAL_DOCS) out[doc] = acceptanceStatus(doc, rows);
      res.setHeader("Cache-Control", "no-store");
      res.json(out);
    } catch (err) {
      logger.error({ err }, "legal: acceptance read failed");
      res.status(500).json({ error: "Acceptance status unavailable", code: "INTERNAL" });
    }
  });

  router.post(
    "/api/legal/acceptance",
    requireAuth,
    writeRateLimiter,
    async (req: Request, res: Response) => {
      const parsed = acceptSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid acceptance", code: "BAD_REQUEST" });
        return;
      }
      const { doc, version } = parsed.data;
      if (version !== CURRENT_VERSIONS[doc]) {
        res.status(409).json({
          error: "That version is no longer current — reload to see the latest terms.",
          code: "STALE_VERSION",
          current: CURRENT_VERSIONS[doc],
        });
        return;
      }
      try {
        const userId = await deps.ensureUser(req.privyUserId ?? "");
        await deps.record(userId, doc, version);
        res.status(201).json({ ok: true, doc, version });
      } catch (err) {
        logger.error({ err }, "legal: acceptance write failed");
        res.status(500).json({ error: "Could not record acceptance", code: "INTERNAL" });
      }
    },
  );

  return router;
}

export const legalRouter = createLegalRouter();
