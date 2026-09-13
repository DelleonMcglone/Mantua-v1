import { Redis } from "@upstash/redis";
import type { RequestHandler } from "express";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import type { RedisRateLimitClient } from "./rate-limit-redis-store.ts";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The Vercel-cron money loops (C-020). All three are GET routes — Vercel
 * Cron always GETs — so the write-method gate never saw them, yet each
 * executes real agent-signed trades:
 *   - /api/cron/rebalance  → runAutoRebalance()      → agent swaps
 *   - /api/cron/intents    → runIntentSweep()        → agent swap retries
 *   - /api/cron/strategies → executeTriggeredClose() → on-chain position closes
 * Enumerated exactly on purpose: the read-only crons (peg-sync, resolution,
 * sports-sync) keep running while the switch is engaged.
 */
const MONEY_CRON_PATHS: ReadonlySet<string> = new Set([
  "/api/cron/rebalance",
  "/api/cron/intents",
  "/api/cron/strategies",
]);

/** Express routes match with or without a trailing slash; the refusal set must cover both spellings. */
function withoutTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

/**
 * Redis key holding the runtime kill-switch flag — the same Upstash database
 * as the shared rate-limit store (C-021; runbook §7). `1` = engaged; `0` or
 * absent = disengaged. Set from the Upstash console/redis-cli, no redeploy.
 */
export const KILL_SWITCH_FLAG_KEY = "mantua:kill-switch";

/**
 * The flag read as a Lua script. The shared client surface (C-021's
 * `RedisRateLimitClient`) exposes `eval` only, so the plain GET rides a
 * one-line script against the same client shape.
 */
export const KILL_SWITCH_READ_SCRIPT = `return redis.call("GET", KEYS[1])`;

/**
 * How long a flag value read from Redis is trusted before the next read.
 * This bounds how long an engagement takes to propagate to an already-warm
 * lambda (the C-020 bar: effective without a redeploy) while keeping the
 * flag's cost at one Redis read per instance per window, not per request.
 */
const FLAG_CACHE_TTL_MS = 15_000;

export interface RuntimeKillSwitchFlag {
  /** The last-known engagement state, re-read from Redis when the cache lapses. */
  read(): Promise<boolean>;
}

/**
 * Anything that is not an explicit "0" or an absent key fails SAFE (engaged):
 * a mangled flag value must stop the platform loudly, never silently keep it
 * trading.
 */
export function parseKillSwitchFlagReply(reply: unknown): boolean {
  if (reply === "1") return true;
  if (reply == null || reply === "0") return false;
  logger.warn({ reply }, "kill-switch flag value unrecognized — treating as engaged (fail-safe)");
  return true;
}

export function createRuntimeKillSwitchFlag({
  client,
  key = KILL_SWITCH_FLAG_KEY,
  cacheTtlMs = FLAG_CACHE_TTL_MS,
}: {
  client: RedisRateLimitClient;
  key?: string;
  cacheTtlMs?: number;
}): RuntimeKillSwitchFlag {
  let cache: { value: boolean; readAt: number } | undefined;
  return {
    async read(): Promise<boolean> {
      if (cache && Date.now() - cache.readAt < cacheTtlMs) return cache.value;
      try {
        const value = parseKillSwitchFlagReply(
          await client.eval(KILL_SWITCH_READ_SCRIPT, [key], []),
        );
        cache = { value, readAt: Date.now() };
      } catch (err) {
        // Outage posture: keep the last known value — an engagement must
        // never be silently lifted by a Redis outage. With no value ever
        // read (Redis down since boot) this fails open for availability,
        // the same profile as the shared rate-limit store; the deploy-time
        // MANTUA_KILL_SWITCH still works without Redis.
        logger.warn({ err }, "kill-switch flag read failed — keeping last known state");
      }
      return cache?.value ?? false;
    },
  };
}

/**
 * The runtime flag over the shared store when Redis is configured; without
 * it the switch stays deploy-time only (the C-021 fallback posture).
 */
function runtimeFlagFromEnv(): RuntimeKillSwitchFlag | undefined {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = env;
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return undefined;
  return createRuntimeKillSwitchFlag({
    client: new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN }),
  });
}

export function createKillSwitchGate({
  envEngaged,
  runtime,
}: {
  envEngaged: boolean;
  runtime?: RuntimeKillSwitchFlag | undefined;
}): RequestHandler {
  return async (req, res, next) => {
    const runtimeEngaged = runtime ? await runtime.read() : false;
    if (!envEngaged && !runtimeEngaged) {
      next();
      return;
    }
    if (!WRITE_METHODS.has(req.method) && !MONEY_CRON_PATHS.has(withoutTrailingSlash(req.path))) {
      next();
      return;
    }
    logger.warn({ method: req.method, path: req.path }, "kill switch refused request");
    res.status(503).json({
      error: "Mantua trading and write operations are temporarily disabled.",
      code: "KILL_SWITCH_ACTIVE",
    });
  };
}

/** The one runtime flag reader for this instance — the gate and the status
 *  snapshot share its 15 s cache, so they never disagree within a window. */
const runtimeFlag = runtimeFlagFromEnv();

/**
 * Phase 7 / R-005 — is the switch engaged right now (deploy-time OR runtime)?
 * The same answer the gate gives, for `/api/status` and the live stream, so
 * a paused platform is announced to every client rather than discovered one
 * refused POST at a time.
 */
export async function killSwitchEngaged(): Promise<boolean> {
  if (env.MANTUA_KILL_SWITCH) return true;
  return runtimeFlag ? runtimeFlag.read() : false;
}

export const killSwitch: RequestHandler = createKillSwitchGate({
  envEngaged: env.MANTUA_KILL_SWITCH,
  runtime: runtimeFlag,
});
