import { Router, type Request, type Response } from "express";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { events, leagues, marketPositions, markets } from "../db/schema/markets.ts";
import {
  readWalletPerformance,
  settledHistory,
  type AgentPerformance,
  type MarketLabel,
} from "../lib/agent/performance.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { walletRateLimiter } from "../middleware/rate-limit.ts";

/**
 * Phase 9 / PF-002, PF-007, PF-012 — the economics behind the portfolio:
 *
 *   GET /api/portfolio/economics — the realized sports-market P&L and win
 *   rate for the wallet. The `lp` list is kept (empty) for the client's
 *   shape check; liquidity provision left the product with D-123.
 *   GET /api/portfolio/settled  — resolved markets the wallet traded, with
 *   cost, proceeds, payout, realized P&L and whether the win was claimed.
 *
 * Every number is computed from the ledgers and the chain; nothing here is
 * a placeholder, and unknowns are null.
 */
export interface PortfolioEconomicsDeps {
  performance: (address: string) => Promise<AgentPerformance>;
  labels: (marketIds: readonly string[]) => Promise<Map<string, MarketLabel>>;
  redeemed: (address: string, marketIds: readonly string[]) => Promise<Set<string>>;
}

async function labelsFor(ids: readonly string[]): Promise<Map<string, MarketLabel>> {
  const out = new Map<string, MarketLabel>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      marketId: markets.marketId,
      outcomeIndex: markets.outcomeIndex,
      state: markets.state,
      resolvedAt: markets.resolvedAt,
      homeTeam: events.homeTeam,
      awayTeam: events.awayTeam,
      providerEventId: events.providerEventId,
      league: leagues.slug,
    })
    .from(markets)
    .innerJoin(events, eq(markets.eventId, events.id))
    .innerJoin(leagues, eq(events.leagueId, leagues.id))
    .where(inArray(markets.marketId, [...ids]));
  for (const r of rows) {
    const winner = r.outcomeIndex === 0 ? r.homeTeam : r.awayTeam;
    const opponent = r.outcomeIndex === 0 ? r.awayTeam : r.homeTeam;
    out.set(r.marketId.toLowerCase(), {
      marketId: r.marketId,
      label: `${winner} to beat ${opponent}`,
      league: r.league,
      providerEventId: r.providerEventId,
      state: r.state,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    });
  }
  return out;
}

async function redeemedFor(address: string, ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ marketId: marketPositions.marketId })
    .from(marketPositions)
    .where(
      and(
        eq(marketPositions.walletAddress, address.toLowerCase()),
        inArray(marketPositions.marketId, [...ids]),
        isNotNull(marketPositions.redeemedAt),
      ),
    );
  for (const r of rows) out.add(r.marketId.toLowerCase());
  return out;
}

function requireWallet(req: Request, res: Response): string | null {
  if (!req.privyUserId) {
    res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
    return null;
  }
  if (!req.walletAddress) {
    res.status(409).json({ error: "No wallet linked to this user yet.", code: "WALLET_REQUIRED" });
    return null;
  }
  return req.walletAddress;
}

export function createPortfolioEconomicsRouter(
  overrides: Partial<PortfolioEconomicsDeps> = {},
): Router {
  const deps: PortfolioEconomicsDeps = {
    performance: overrides.performance ?? ((address) => readWalletPerformance(db, address)),
    labels: overrides.labels ?? labelsFor,
    redeemed: overrides.redeemed ?? redeemedFor,
  };
  const router = Router();

  router.get(
    "/api/portfolio/economics",
    walletRateLimiter,
    requireAuth,
    async (req: Request, res: Response) => {
      const wallet = requireWallet(req, res);
      if (!wallet) return;
      try {
        const performance = await deps.performance(wallet);
        res.setHeader("Cache-Control", "private, no-store");
        res.json({
          lp: [],
          lpTotals: {
            positions: 0,
            currentValueUsd: 0,
            accruedFeesUsd: 0,
            depositedUsd: 0,
            pnlUsd: 0,
            withoutBasis: 0,
          },
          realized: {
            marketRealizedPnlUsd: performance.totals.realizedPnlUsd,
            marketWinRate: performance.totals.winRate,
            resolvedMarkets: performance.totals.resolvedMarkets,
            openCostUsd: performance.totals.openCostUsd,
            bySource: performance.totals.bySource,
          },
        });
      } catch (err) {
        logger.warn({ err }, "portfolio economics failed");
        res.status(500).json({ error: "Failed to load portfolio economics", code: "INTERNAL" });
      }
    },
  );

  router.get(
    "/api/portfolio/settled",
    walletRateLimiter,
    requireAuth,
    async (req: Request, res: Response) => {
      const wallet = requireWallet(req, res);
      if (!wallet) return;
      try {
        const perf = await deps.performance(wallet);
        const ids = perf.markets.filter((m) => m.status !== "open").map((m) => m.marketId);
        const [labels, redeemed] = await Promise.all([
          deps.labels(ids),
          deps.redeemed(wallet, ids),
        ]);
        res.setHeader("Cache-Control", "private, no-store");
        res.json(settledHistory(perf, labels, redeemed));
      } catch (err) {
        logger.warn({ err }, "portfolio settled history failed");
        res.status(500).json({ error: "Failed to load settled positions", code: "INTERNAL" });
      }
    },
  );

  return router;
}

export const portfolioEconomicsRouter = createPortfolioEconomicsRouter();
