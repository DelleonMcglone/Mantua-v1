import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { userPreferences, users } from "../db/schema/users.ts";
import {
  DEFAULT_CHAIN_ID,
  isSupportedChainId,
  type SupportedChainId,
} from "../lib/chains.ts";
import { logger } from "../lib/logger.ts";
import { getPortfolioHistory } from "../lib/portfolio-history.ts";
import { HISTORY_RANGES } from "../lib/price-history.ts";
import { getUserPortfolio } from "../lib/user-portfolio.ts";
import { requireAuth } from "../middleware/auth.ts";
import { walletRateLimiter, writeRateLimiter } from "../middleware/rate-limit.ts";

function readChainId(req: Request): SupportedChainId {
  const raw = req.query.chainId;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (isSupportedChainId(n)) return n;
  }
  return DEFAULT_CHAIN_ID;
}

export const portfolioRouter = Router();

/**
 * P8-003 / P8-004 / P8-005 — user wallet portfolio: balances + tx
 * history + preferences. The chat-mode "Portfolio Summary" UI (P6-008
 * for agent, P8-001 for user) is deferred to TD-004; this route is
 * the data layer underneath.
 *
 * Returns the same shape as `GET /api/agent/portfolio`, plus a
 * `preferences` block carrying the user's stored slippage / cap /
 * hide-small-balances flags so the Balances tab can render the toggle
 * (P8-006) without a second round-trip.
 *
 * LP positions live at `GET /api/positions` (P4-009) — kept separate
 * because that path also enriches with on-chain `PositionManager`
 * view calls and pre-Mantua positions discovered via the v4
 * subgraph; folding it in here would couple the lookup to a possibly-
 * slow subgraph fetch.
 */
portfolioRouter.get(
  "/api/portfolio",
  walletRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    const walletAddress = req.walletAddress;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    if (!walletAddress) {
      res.status(409).json({
        error: "No wallet linked to this user yet.",
        code: "WALLET_REQUIRED",
      });
      return;
    }
    try {
      const chainId = readChainId(req);
      const portfolio = await getUserPortfolio(privyUserId, walletAddress, 50, chainId);
      res.json({ ...portfolio, chainId });
    } catch (err) {
      logger.error({ err }, "user portfolio fetch failed");
      res.status(502).json({
        error: "Failed to load portfolio",
        code: "UPSTREAM_FAILURE",
      });
    }
  },
);

/**
 * Portfolio chart series for the home shell. Returns a USD-value
 * time series across the requested range, weighted by the user's
 * current holdings (see `portfolio-history.ts` for the assumption
 * caveat). Granularity is whatever CoinGecko returns for the
 * underlying `days` window: 5-min for 1H/1D, hourly for TW/1M,
 * daily for 1Y.
 */
const historyRangeSchema = z.enum(HISTORY_RANGES as [string, ...string[]]);

portfolioRouter.get(
  "/api/portfolio/history",
  walletRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    const walletAddress = req.walletAddress;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    if (!walletAddress) {
      res.status(409).json({
        error: "No wallet linked to this user yet.",
        code: "WALLET_REQUIRED",
      });
      return;
    }
    const parsed = historyRangeSchema.safeParse(req.query.range);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid range. Expected one of 1H, 1D, TW, 1M, 1Y.",
        code: "BAD_REQUEST",
      });
      return;
    }
    try {
      const portfolio = await getUserPortfolio(privyUserId, walletAddress);
      const history = await getPortfolioHistory(
        portfolio.balances,
        parsed.data as (typeof HISTORY_RANGES)[number],
      );
      res.json(history);
    } catch (err) {
      logger.error({ err }, "portfolio history fetch failed");
      res.status(502).json({
        error: "Failed to load portfolio history",
        code: "UPSTREAM_FAILURE",
      });
    }
  },
);

/**
 * P8-006 — toggle / set the user's `hide_small_balances` preference
 * (and other prefs while we're here). Persists to `user_preferences`.
 * The client passes whichever keys it wants to update; missing keys
 * are left alone.
 */
const prefsSchema = z
  .object({
    hideSmallBalances: z.boolean().optional(),
    defaultSlippageBps: z.coerce.number().int().min(0).max(500).optional(),
  })
  .refine(
    (v) => v.hideSmallBalances !== undefined || v.defaultSlippageBps !== undefined,
    "At least one preference field is required.",
  );

portfolioRouter.patch(
  "/api/preferences",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const privyUserId = req.privyUserId;
    if (!privyUserId) {
      res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
      return;
    }
    const parsed = prefsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        code: "BAD_REQUEST",
        details: parsed.error.issues,
      });
      return;
    }
    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.privyUserId, privyUserId))
      .limit(1);
    const user = userRows.at(0);
    if (!user) {
      res.status(409).json({
        error: "Connect your primary wallet first.",
        code: "USER_NOT_FOUND",
      });
      return;
    }

    const v = parsed.data;
    const update: Partial<typeof userPreferences.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (v.hideSmallBalances !== undefined) {
      update.hideSmallBalances = v.hideSmallBalances;
    }
    if (v.defaultSlippageBps !== undefined) {
      update.defaultSlippageBps = String(v.defaultSlippageBps);
    }

    await db
      .insert(userPreferences)
      .values({
        userId: user.id,
        ...update,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { ...update, updatedAt: sql`now()` },
      });

    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id))
      .limit(1);
    const pref = rows.at(0);
    if (!pref) {
      res.status(500).json({ error: "Preferences row vanished", code: "INTERNAL" });
      return;
    }
    res.json({
      hideSmallBalances:
        typeof pref.hideSmallBalances === "boolean" ? pref.hideSmallBalances : true,
      defaultSlippageBps: pref.defaultSlippageBps,
      dailyCapUsd: pref.dailyCapUsd,
    });
  },
);
