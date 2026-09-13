import { Redis } from "@upstash/redis";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Options, Store } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { env } from "../env.ts";
import { createRedisRateLimitStore } from "./rate-limit-redis-store.ts";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_MIN_MS = 60 * 1000;

/**
 * Skip rate limits in `development` so a single dev user running the
 * full polling loop (portfolio every 15s + history + positions +
 * max-input + …) doesn't trip the prod ceilings inside a 15-min
 * window. Test/prod still enforce the limits.
 */
const skipInDev = () => env.NODE_ENV === "development";

/**
 * Phase 7 / R-008 — the load test drives hundreds of virtual users from one
 * IP, which the per-IP limiters would (correctly) refuse. Requests carrying
 * the configured secret skip them. No secret configured → no bypass.
 */
export const LOAD_TEST_HEADER = "x-mantua-load-test";
function loadTestBypass(req: Request): boolean {
  const secret = env.LOAD_TEST_SECRET;
  return typeof secret === "string" && req.get(LOAD_TEST_HEADER) === secret;
}
const skipLimiter = (req: Request): boolean => skipInDev() || loadTestBypass(req);

/**
 * C-021 — the shared counter store. Every limiter below used to count in
 * process memory, so each Vercel lambda instance kept its own windows and a
 * recycle reset them. With Upstash's REST credentials configured, all four
 * limiters count into one Redis-backed fixed window shared by every
 * instance. Unconfigured → per-instance MemoryStore (the old behavior),
 * with a production warning so the gap is visible in logs. The choice of
 * Upstash and the provisioning steps live in docs/ops/incident-runbook.md.
 */
function sharedRateLimitStore(prefix: string, windowMs: number): Store | undefined {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = env;
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    if (env.NODE_ENV === "production") {
      console.warn(
        "[rate-limit] shared store not configured (UPSTASH_REDIS_REST_URL/TOKEN unset): counters are per-lambda-instance and reset on recycle — see docs/ops/incident-runbook.md",
      );
    }
    return undefined;
  }
  return createRedisRateLimitStore({
    client: new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN }),
    prefix,
    windowMs,
  });
}

/** express-rate-limit's Logger contract (error/warn taking the error first). */
const rateLimitLogger = {
  error: (error: unknown, message?: string): void => {
    console.error("[rate-limit]", error, message);
  },
  warn: (error: unknown, message?: string): void => {
    console.warn("[rate-limit]", error, message);
  },
};

/**
 * Attach the shared store to a limiter's options when Redis is configured.
 * passOnStoreError keeps a Redis outage from converting every API request
 * into a 500: the request passes uncounted and the error is logged (limits
 * fail open — same availability profile as the old memory store; the
 * runbook covers the operational picture).
 */
function withSharedStore(
  prefix: string,
  windowMs: number,
  options: Partial<Options>,
): Partial<Options> {
  const store = sharedRateLimitStore(prefix, windowMs);
  if (!store) return options;
  return { ...options, store, passOnStoreError: true, logger: rateLimitLogger };
}

/**
 * P1-007 — generic per-IP limiter for any API route. 1000 req / 15 min.
 * This is the global ceiling — sized so ONE legitimate user's polling loop
 * (portfolio every 15s + prices + positions + pool state + charts ≈ several
 * hundred requests per window) never trips it, while still stopping floods.
 * The 100/15min it replaced was below a single active session's traffic and
 * rate-limited normal usage. Chain-touching paths keep the much tighter
 * writeRateLimiter on top.
 */
export const ipRateLimiter: RequestHandler = rateLimit(
  withSharedStore("mantua:rl:ip:", FIFTEEN_MIN_MS, {
    windowMs: FIFTEEN_MIN_MS,
    limit: 1000,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: skipLimiter,
    message: { error: "Too many requests from this IP.", code: "RATE_LIMITED" },
  }),
);

/**
 * Tighter limiter for write paths that touch the chain (swap, LP, agent).
 * 20 req / minute per IP. Intended to short-circuit obvious abuse before
 * any of the more expensive checks (cap lookup, quote fetch) run.
 */
export const writeRateLimiter: RequestHandler = rateLimit(
  withSharedStore("mantua:rl:write:", ONE_MIN_MS, {
    windowMs: ONE_MIN_MS,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: skipLimiter,
    message: { error: "Too many write requests.", code: "RATE_LIMITED" },
  }),
);

/**
 * Per-wallet rate limiter. Until Phase 2 wires Privy auth, the wallet is
 * unknown at this layer — so this falls back to per-IP. After Phase 2,
 * `req.walletAddress` will be populated and the limiter will key on that.
 */
export const walletRateLimiter: RequestHandler = rateLimit(
  withSharedStore("mantua:rl:wallet:", ONE_MIN_MS, {
    windowMs: ONE_MIN_MS,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: skipLimiter,
    keyGenerator: (req: Request) => {
      const wallet = (req as Request & { walletAddress?: string }).walletAddress;
      if (wallet) return `wallet:${wallet.toLowerCase()}`;
      return `ip:${ipKeyGenerator(req.ip ?? "")}`;
    },
    message: { error: "Too many requests for this wallet.", code: "RATE_LIMITED" },
  }),
);

/**
 * The anonymous analyst quota (owner decision 2026-08-18): three free
 * questions per IP per day, then the login gate. Logged-in users skip it
 * entirely (their traffic is governed by walletRateLimiter). Counted
 * through the shared Redis store (C-021) when configured, so the quota
 * survives instance recycles; without Redis it degrades to per-instance
 * memory — see sharedRateLimitStore.
 */
export const freeAnalystQuota: RequestHandler = rateLimit(
  withSharedStore("mantua:rl:free-analyst:", 24 * 60 * 60 * 1000, {
    windowMs: 24 * 60 * 60 * 1000,
    limit: 3,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (req: Request) => skipInDev() || Boolean(req.privyUserId),
    keyGenerator: (req: Request) => `free:${ipKeyGenerator(req.ip ?? "")}`,
    handler: (_req, res) => {
      res.status(401).json({
        error: "You've used your 3 free analyst questions — log in to keep chatting.",
        code: "LOGIN_REQUIRED",
      });
    },
  }),
);
