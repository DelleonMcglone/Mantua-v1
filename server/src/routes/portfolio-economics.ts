import { Router, type Request, type Response } from "express";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { events, leagues, marketPositions, markets } from "../db/schema/markets.ts";
import { portfolioTransactions } from "../db/schema/trading.ts";
import {
  readWalletPerformance,
  settledHistory,
  type AgentPerformance,
  type MarketLabel,
} from "../lib/agent/performance.ts";
import { DEFAULT_CHAIN_ID } from "../lib/chains.ts";
import { logger } from "../lib/logger.ts";
import {
  basisFromLedger,
  computeLpEconomics,
  totalLpEconomics,
  type LpEconomics,
} from "../lib/lp-economics.ts";
import { resolveUserId } from "../lib/sports/strategy-store.ts";
import { getToken, isTokenSymbol } from "../lib/tokens.ts";
import { getUsdPrice, tokenAmountUsdForToken } from "../lib/usd-pricing.ts";
import { readOnchainPositions, type OnchainPosition } from "../lib/v4-onchain-positions.ts";
import { requireAuth } from "../middleware/auth.ts";
import { walletRateLimiter } from "../middleware/rate-limit.ts";

/**
 * Phase 9 / PF-002, PF-007, PF-012 — the economics behind the portfolio:
 *
 *   GET /api/portfolio/economics — every open LP position with deposited
 *   basis (from the add-liquidity ledger rows), current value at live
 *   prices, accrued fees, P&L, pool share when known; plus the realized
 *   sports-market P&L and win rate for the same wallet.
 *   GET /api/portfolio/settled  — resolved markets the wallet traded, with
 *   cost, proceeds, payout, realized P&L and whether the win was claimed.
 *
 * Every number is computed from the ledgers and the chain; nothing here is
 * a placeholder, and unknowns are null (see lib/lp-economics.ts).
 */
export interface PortfolioEconomicsDeps {
  onchainPositions: (owner: `0x${string}`) => Promise<OnchainPosition[]>;
  ledgerAdds: (
    userId: string,
  ) => Promise<{ params: unknown; usdValue: string | null; createdAt: Date }[]>;
  price: (symbol: string) => Promise<number>;
  feesUsd: (position: OnchainPosition) => Promise<number>;
  /** Pool liquidity for the position's pool; null when unknown (share stays null). */
  poolLiquidity: (position: OnchainPosition) => Promise<bigint | null>;
  performance: (address: string) => Promise<AgentPerformance>;
  labels: (marketIds: readonly string[]) => Promise<Map<string, MarketLabel>>;
  redeemed: (address: string, marketIds: readonly string[]) => Promise<Set<string>>;
  resolveUser: (privyUserId: string) => Promise<string | null>;
}

async function ledgerAddsFor(userId: string) {
  return db
    .select({
      params: portfolioTransactions.params,
      usdValue: portfolioTransactions.usdValue,
      createdAt: portfolioTransactions.createdAt,
    })
    .from(portfolioTransactions)
    .where(
      and(
        eq(portfolioTransactions.userId, userId),
        eq(portfolioTransactions.action, "add_liquidity"),
        eq(portfolioTransactions.outcome, "success"),
      ),
    );
}

async function feesUsdFor(p: OnchainPosition): Promise<number> {
  let total = 0;
  for (const [sym, raw] of [
    [p.tokenA, p.fees0],
    [p.tokenB, p.fees1],
  ] as const) {
    if (!isTokenSymbol(sym) || raw === "0") continue;
    try {
      total += await tokenAmountUsdForToken(getToken(sym, DEFAULT_CHAIN_ID), BigInt(raw));
    } catch {
      // price unavailable — fees stay uncounted rather than invented
    }
  }
  return total;
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

export function createPortfolioEconomicsRouter(
  overrides: Partial<PortfolioEconomicsDeps> = {},
): Router {
  const deps: PortfolioEconomicsDeps = {
    onchainPositions: overrides.onchainPositions ?? ((owner) => readOnchainPositions(owner)),
    ledgerAdds: overrides.ledgerAdds ?? ledgerAddsFor,
    price:
      overrides.price ??
      ((symbol) => (isTokenSymbol(symbol) ? getUsdPrice(symbol) : Promise.resolve(0))),
    feesUsd: overrides.feesUsd ?? feesUsdFor,
    poolLiquidity: overrides.poolLiquidity ?? (() => Promise.resolve(null)),
    performance: overrides.performance ?? ((address) => readWalletPerformance(db, address)),
    labels: overrides.labels ?? labelsFor,
    redeemed: overrides.redeemed ?? redeemedFor,
    resolveUser: overrides.resolveUser ?? ((privyUserId) => resolveUserId(db, privyUserId)),
  };
  const router = Router();

  router.get(
    "/api/portfolio/economics",
    walletRateLimiter,
    requireAuth,
    async (req: Request, res: Response) => {
      const privyUserId = req.privyUserId;
      const wallet = req.walletAddress;
      if (!privyUserId) {
        res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
        return;
      }
      if (!wallet) {
        res
          .status(409)
          .json({ error: "No wallet linked to this user yet.", code: "WALLET_REQUIRED" });
        return;
      }
      try {
        const owner = wallet as `0x${string}`;
        const [positions, userId, performance] = await Promise.all([
          deps.onchainPositions(owner),
          deps.resolveUser(privyUserId),
          deps.performance(owner),
        ]);
        const basis = basisFromLedger(userId ? await deps.ledgerAdds(userId) : []);
        const lp: LpEconomics[] = await Promise.all(
          positions.map(async (p) => {
            const [a, b, fees, poolLiq] = await Promise.all([
              deps.price(p.tokenA),
              deps.price(p.tokenB),
              deps.feesUsd(p),
              deps.poolLiquidity(p).catch(() => null),
            ]);
            return computeLpEconomics(
              {
                tokenId: p.tokenId,
                tokenA: p.tokenA,
                tokenB: p.tokenB,
                amountA: p.amountA,
                amountB: p.amountB,
                liquidity: p.liquidity,
                hook: p.hook,
                fee: p.fee,
              },
              { a, b },
              basis.get(p.tokenId) ?? null,
              fees,
              poolLiq,
            );
          }),
        );
        res.setHeader("Cache-Control", "private, no-store");
        res.json({
          lp,
          lpTotals: totalLpEconomics(lp),
          realized: {
            marketRealizedPnlUsd: performance.totals.realizedPnlUsd,
            marketWinRate: performance.totals.winRate,
            resolvedMarkets: performance.totals.resolvedMarkets,
            openCostUsd: performance.totals.openCostUsd,
            bySource: performance.totals.bySource,
            /** LP fees are collected on-chain by the sweep; a collected-fee
             *  ledger is not kept yet, so realized LP earnings are not claimed. */
            lpCollectedUsd: null,
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
      const wallet = req.walletAddress;
      if (!req.privyUserId) {
        res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
        return;
      }
      if (!wallet) {
        res
          .status(409)
          .json({ error: "No wallet linked to this user yet.", code: "WALLET_REQUIRED" });
        return;
      }
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
