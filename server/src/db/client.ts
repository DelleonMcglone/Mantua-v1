import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import * as schema from "./schema/index.ts";

/**
 * Phase 7 / R-002 — the pool is sized for a serverless deployment: every
 * lambda instance holds its own `Pool`, so `max` is per instance and the
 * true ceiling is `max × instances` against Neon's pooler. Defaults are
 * small on purpose (`DATABASE_POOL_MAX`, 5); a game-time fan-out of
 * instances must not exhaust the database's connection slots. Timeouts
 * turn a stuck connection or a runaway query into a fast, logged failure
 * instead of a held lambda: `connectionTimeoutMillis` bounds the wait for
 * a slot, `query_timeout` bounds one statement, `idleTimeoutMillis`
 * releases slots between bursts. The pool's `error` event is handled so an
 * idle-client error (Neon pooler recycle) is a log line, not an unhandled
 * exception that kills the instance.
 */
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS,
  query_timeout: env.DATABASE_QUERY_TIMEOUT_MS,
  application_name: "mantua-api",
});

pool.on("error", (err) => {
  logger.warn({ err }, "pg pool: idle client error (connection recycled)");
});

export const db = drizzle({ client: pool, schema });
export type DB = typeof db;

/** Live pool counters for `/api/ops/metrics` (R-010) and the status read. */
export function dbPoolSnapshot(): { total: number; idle: number; waiting: number; max: number } {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: env.DATABASE_POOL_MAX,
  };
}
