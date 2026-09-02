import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { env } from "../env.ts";

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
 * P1-007 — generic per-IP limiter for any API route. 1000 req / 15 min.
 * This is the global ceiling — sized so ONE legitimate user's polling loop
 * (portfolio every 15s + prices + positions + pool state + charts ≈ several
 * hundred requests per window) never trips it, while still stopping floods.
 * The 100/15min it replaced was below a single active session's traffic and
 * rate-limited normal usage. Chain-touching paths keep the much tighter
 * writeRateLimiter on top.
 */
export const ipRateLimiter: RequestHandler = rateLimit({
  windowMs: FIFTEEN_MIN_MS,
  limit: 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipInDev,
  message: { error: "Too many requests from this IP.", code: "RATE_LIMITED" },
});

/**
 * Tighter limiter for write paths that touch the chain (swap, LP, agent).
 * 20 req / minute per IP. Intended to short-circuit obvious abuse before
 * any of the more expensive checks (cap lookup, quote fetch) run.
 */
export const writeRateLimiter: RequestHandler = rateLimit({
  windowMs: ONE_MIN_MS,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipInDev,
  message: { error: "Too many write requests.", code: "RATE_LIMITED" },
});

/**
 * Per-wallet rate limiter. Until Phase 2 wires Privy auth, the wallet is
 * unknown at this layer — so this falls back to per-IP. After Phase 2,
 * `req.walletAddress` will be populated and the limiter will key on that.
 */
export const walletRateLimiter: RequestHandler = rateLimit({
  windowMs: ONE_MIN_MS,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: skipInDev,
  keyGenerator: (req: Request) => {
    const wallet = (req as Request & { walletAddress?: string }).walletAddress;
    if (wallet) return `wallet:${wallet.toLowerCase()}`;
    return `ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
  message: { error: "Too many requests for this wallet.", code: "RATE_LIMITED" },
});

/**
 * The anonymous analyst quota (owner decision 2026-08-18): three free
 * questions per IP per day, then the login gate. Logged-in users skip it
 * entirely (their traffic is governed by walletRateLimiter). Counted
 * in-memory, so a serverless instance recycle resets it — acceptable for
 * a signup funnel; anyone determined enough to rotate IPs was never going
 * to convert at question four.
 */
export const freeAnalystQuota: RequestHandler = rateLimit({
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
});
