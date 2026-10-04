/**
 * `POST /api/waitlist` — the landing page's sign-up (owner, 2026-10-04).
 * Anonymous by design: a visitor leaves an email and nothing else. The
 * email is trimmed, lower-cased and validated here; the store's unique
 * index makes a repeat submit a quiet `already: true`. Rate-limited per
 * IP with the write limiter; the global limiter and kill switch apply.
 */
import { Router, type Request, type Response } from "express";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { waitlist } from "../db/schema/waitlist.ts";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import { DEFAULT_SENDER, sendConfirmation } from "../lib/waitlist/confirmation.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

export interface WaitlistDeps {
  /** Persist one signup; false when the email was already on the list. */
  save: (row: { email: string; source: string; userAgent: string | null }) => Promise<boolean>;
  /** The confirmation email, sent once per fresh signup; never throws. */
  confirm: (email: string) => Promise<unknown>;
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
  const deps: WaitlistDeps = {
    save: saveToDb,
    confirm: (email) =>
      sendConfirmation(email, {
        apiKey: env.RESEND_API_KEY,
        sender: env.WAITLIST_SENDER_EMAIL ?? DEFAULT_SENDER,
        fetch,
      }),
    ...overrides,
  };
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
      if (fresh) {
        // Awaited so the function never exits mid-send (Resend answers in
        // well under a second); a refusal is a log line, not a failed signup.
        const outcome = await deps.confirm(parsed.data.email);
        logger.info({ outcome }, "waitlist confirmation");
      }
      res.json({ ok: true, already: !fresh });
    } catch (err) {
      logger.warn({ err }, "waitlist signup failed");
      res.status(500).json({ error: "Could not save your email. Try again.", code: "INTERNAL" });
    }
  });
  return router;
}

export const waitlistRouter = createWaitlistRouter();

/**
 * `GET /api/ops/waitlist.csv` — the owner's export, guarded like the crons
 * (Bearer CRON_SECRET). One row per signup, oldest first; a text/csv
 * attachment so a browser or `curl -O` saves it as a file.
 */
export interface WaitlistExportDeps {
  list: () => Promise<{ email: string; source: string; createdAt: Date }[]>;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function waitlistCsv(rows: { email: string; source: string; createdAt: Date }[]): string {
  const lines = ["email,source,created_at"];
  for (const r of rows) {
    lines.push([csvCell(r.email), csvCell(r.source), r.createdAt.toISOString()].join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function createWaitlistExportRouter(overrides: Partial<WaitlistExportDeps> = {}): Router {
  const deps: WaitlistExportDeps = {
    list: () =>
      db
        .select({ email: waitlist.email, source: waitlist.source, createdAt: waitlist.createdAt })
        .from(waitlist)
        .orderBy(asc(waitlist.createdAt)),
    ...overrides,
  };
  const router = Router();
  router.get("/api/ops/waitlist.csv", requireCronSecret, async (_req: Request, res: Response) => {
    try {
      const rows = await deps.list();
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="mantua-waitlist.csv"');
      res.send(waitlistCsv(rows));
    } catch (err) {
      logger.warn({ err }, "waitlist export failed");
      res.status(500).json({ error: "Failed to export the waitlist", code: "INTERNAL" });
    }
  });
  return router;
}

export const waitlistExportRouter = createWaitlistExportRouter();
