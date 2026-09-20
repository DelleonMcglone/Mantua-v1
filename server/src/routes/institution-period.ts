import type { Request, Response } from "express";
import { z } from "zod";

/**
 * Task 073 / IC-002 — the reporting period from the query string: ISO
 * instants `from` / `to`, `format` json or csv. Defaults to the last 30
 * days ending now; refuses an empty, inverted or over-long period. Pure
 * apart from writing the 400.
 */

/** At most a year. */
export const MAX_PERIOD_DAYS = 366;
const DEFAULT_DAYS = 30;

const periodSchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

export interface Period {
  from: Date;
  to: Date;
  format: "json" | "csv";
}

export function parsePeriod(
  req: Pick<Request, "query">,
  res: Response,
  now = new Date(),
): Period | null {
  const parsed = periodSchema.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid period", code: "BAD_REQUEST", details: parsed.error.issues });
    return null;
  }
  const to = parsed.data.to ? new Date(parsed.data.to) : now;
  const from = parsed.data.from
    ? new Date(parsed.data.from)
    : new Date(to.getTime() - DEFAULT_DAYS * 86_400_000);
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 0 || days > MAX_PERIOD_DAYS) {
    res.status(400).json({
      error: `The period must be positive and at most ${String(MAX_PERIOD_DAYS)} days.`,
      code: "BAD_PERIOD",
    });
    return null;
  }
  return { from, to, format: parsed.data.format };
}
