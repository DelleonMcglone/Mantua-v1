/**
 * `POST /api/waitlist` — the landing page's sign-up (owner, 2026-10-04).
 * Anonymous by design: a visitor leaves an email and nothing else. The
 * email is trimmed, lower-cased and validated here; the store's unique
 * index makes a repeat submit a quiet `already: true`. Rate-limited per
 * IP with the write limiter; the global limiter and kill switch apply.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import { waitlist } from "../db/schema/waitlist.ts";
import { logger } from "../lib/logger.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

export interface WaitlistDeps {
  /** Persist one signup; false when the email was already on the list. */
  save: (row: { email: string; source: string; userAgent: string | null }) => Promise<boolean>;
}

const body = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  source: z.enum(["landing"]).default("landing"),
});

async function saveToDb(row: {
  email: string;
  source: string;
  userAgent: string | null;
}): Promise<boolean> {
  const inserted = await db
    .insert(waitlist)
    .values(row)
    .onConflictDoNothing({ target: waitlist.email })
    .returning({ id: waitlist.id });
  return inserted.length > 0;
}

export function createWaitlistRouter(overrides: Partial<WaitlistDeps> = {}): Router {
  const deps: WaitlistDeps = { save: saveToDb, ...overrides };
  const router = Router();
  router.post("/api/waitlist", writeRateLimiter, async (req: Request, res: Response) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a valid email address.", code: "BAD_REQUEST" });
      return;
    }
    const ua = req.get("user-agent");
    try {
      const fresh = await deps.save({
        email: parsed.data.email,
        source: parsed.data.source,
        userAgent: ua ? ua.slice(0, 200) : null,
      });
      res.json({ ok: true, already: !fresh });
    } catch (err) {
      logger.warn({ err }, "waitlist signup failed");
      res.status(500).json({ error: "Could not save your email. Try again.", code: "INTERNAL" });
    }
  });
  return router;
}

export const waitlistRouter = createWaitlistRouter();
