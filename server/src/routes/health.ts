import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { env } from "../env.ts";

export const healthRouter = Router();

/** Host part of DATABASE_URL — never credentials. Ops diagnostic: "which
 *  database is this deployment actually talking to?" (a Neon project can
 *  have several branches, and a migration applied to the wrong one looks
 *  exactly like a missing-table bug). */
function dbHost(): string {
  try {
    return new URL(env.DATABASE_URL).host;
  } catch {
    return "unparseable";
  }
}

// Mounted at both paths: locally everything reaches express, but the
// production rewrite only sends /api/* to the function.
healthRouter.get(["/health", "/api/health"], async (_req, res) => {
  let sportsSchema = false;
  let dbError: string | null = null;
  try {
    const r = await db.execute(sql`select to_regclass('public.leagues') is not null as ok`);
    sportsSchema = Boolean((r.rows.at(0) as { ok?: boolean } | undefined)?.ok);
  } catch (err) {
    dbError = err instanceof Error ? err.message.slice(0, 200) : String(err);
  }
  res.json({
    status: "ok",
    env: env.NODE_ENV,
    killSwitch: env.MANTUA_KILL_SWITCH,
    dbHost: dbHost(),
    sportsSchema,
    ...(dbError ? { dbError } : {}),
  });
});
