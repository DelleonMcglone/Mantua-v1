import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import { getTradeSignals, type TradeSignals } from "../lib/agent-signals.ts";
import { priceToProbability, probabilityToAmericanOdds } from "../lib/probability.ts";
import { sharedCache } from "../lib/shared-cache.ts";
import { makeDepthDb } from "../lib/sports/market-depth-db.ts";
import { readMarketDepth, type MarketDepthRead } from "../lib/sports/market-depth-read.ts";
import type { HistoryRow } from "../lib/sports/market-history.ts";
import { readMarketHistory, type HistoryQuery } from "../lib/sports/market-history-db.ts";
import { getX402ServiceDef, parseCommaList, type X402ServiceDef } from "../lib/x402/catalog.ts";
import {
  x402PaywallDepsFromEnv,
  x402ServiceChain,
  type X402PaywallDeps,
} from "../middleware/x402-paywall.ts";

/**
 * Phase 17 (MP-006) — the PAID market-intelligence service on /api/x402/v1:
 * win probability, liquidity, price movement, and sports context for ONE
 * market, in a single read. A thin wrapper over four existing surfaces —
 * market-depth-read (the market page's deeper layer), getTradeSignals (the
 * peg/price environment), market-history-db (recent resolved comparables),
 * and the probability engine (bps → probability → American odds). No new
 * engine logic: every number comes from an existing library read.
 */

const eventIdSchema = z.string().regex(/^\d{1,32}$/);

/** Resolved comparables: a history row minus the price path (paid payloads stay tight). */
export interface ResolvedComparable {
  league: string;
  providerEventId: string;
  home: HistoryRow["home"];
  away: HistoryRow["away"];
  startsAt: number;
  state: string;
  resolvedAt: number | null;
  outcome: HistoryRow["outcome"];
  settlementPriceBps: number | null;
}

function toComparable(row: HistoryRow): ResolvedComparable {
  return {
    league: row.league,
    providerEventId: row.providerEventId,
    home: row.home,
    away: row.away,
    startsAt: row.startsAt,
    state: row.state,
    resolvedAt: row.resolvedAt,
    outcome: row.outcome,
    settlementPriceBps: row.settlementPriceBps,
  };
}

export interface X402IntelligenceDeps {
  /** The market page's deeper layer for one event; null = unknown event. */
  depth: (providerEventId: string) => Promise<MarketDepthRead | null>;
  /** The peg/price environment (agent-signals.ts). */
  signals: () => Promise<TradeSignals>;
  /** Recent resolved moneyline markets — the comparables context. */
  history: (q: HistoryQuery) => Promise<HistoryRow[]>;
  /** Paywall construction inputs (env in production; inline in tests). */
  paywall: X402PaywallDeps;
}

/** The paid intelligence service, by catalog id. */
const INTEL_DEF = getX402ServiceDef("market-intelligence") as X402ServiceDef;

export function createX402IntelligenceRouter(
  overrides: Partial<X402IntelligenceDeps> = {},
): Router {
  const deps: X402IntelligenceDeps = {
    // Same 15 s shared cache as the free depth route — one read, both surfaces.
    depth:
      overrides.depth ??
      ((id) =>
        sharedCache.getOrCompute(`market-depth:${id}`, 15_000, () =>
          readMarketDepth(makeDepthDb(), id),
        )),
    signals: overrides.signals ?? (() => getTradeSignals({})),
    history: overrides.history ?? ((q) => readMarketHistory(q)),
    paywall:
      overrides.paywall ??
      x402PaywallDepsFromEnv({
        ...env,
        X402_SELLER_SERVICES: parseCommaList(env.X402_SELLER_SERVICES),
        X402_SPORTS_INTEL_ALLOWLIST: parseCommaList(env.X402_SPORTS_INTEL_ALLOWLIST),
      }),
  };
  const router = Router();

  /**
   * GET /api/x402/v1/intelligence/market?providerEventId=… — the paid
   * market-intelligence read (MP-006). The depth read is the required core
   * (unknown event 404, read failure 503); the signals environment and the
   * resolved comparables degrade to explicit nulls with a note when their
   * upstreams fail — a paid answer that names what is missing, never a
   * silent gap.
   */
  router.get(
    INTEL_DEF.path,
    ...x402ServiceChain(INTEL_DEF, deps.paywall),
    async (req: Request, res: Response) => {
      const parsed = eventIdSchema.safeParse(req.query.providerEventId);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid providerEventId", code: "BAD_REQUEST" });
        return;
      }
      const providerEventId = parsed.data;
      try {
        const depth = await deps.depth(providerEventId);
        if (!depth) {
          res.status(404).json({ error: "Unknown game", code: "NOT_FOUND" });
          return;
        }
        const metrics = depth.metrics;
        const homeProbabilityBps = metrics?.priceBps ?? null;
        const priceBps = homeProbabilityBps;
        // Probability engine — bps → probability → American odds.
        const homeProbability = priceBps === null ? null : priceToProbability(priceBps / 10_000);
        const homeAmericanOdds =
          homeProbability === null ? null : probabilityToAmericanOdds(homeProbability);

        // Context reads degrade honestly: null + note, never a silent gap.
        const [signals, history] = await Promise.all([
          deps.signals().catch((err: unknown) => {
            logger.warn({ err, providerEventId }, "x402-intelligence: signals read failed");
            return null;
          }),
          deps
            .history({ league: null, limit: 8 })
            .then((rows) => rows.map(toComparable))
            .catch((err: unknown) => {
              logger.warn({ err, providerEventId }, "x402-intelligence: history read failed");
              return null;
            }),
        ]);

        res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
        res.json({
          providerEventId,
          hasMarkets: depth.hasMarkets,
          winProbability: {
            homeProbabilityBps,
            homeProbability,
            homeAmericanOdds,
            source: metrics?.source ?? null,
            capturedAt: metrics?.capturedAt ?? null,
          },
          priceMovement: {
            change24hBps: metrics?.change24hBps ?? null,
          },
          liquidity: metrics
            ? {
                volume: metrics.volume,
                activity: metrics.activity,
                openInterest: metrics.openInterest,
              }
            : null,
          sportsContext: {
            game: depth.game,
            hasMarkets: depth.hasMarkets,
          },
          marketEnvironment:
            signals === null
              ? null
              : { prices: signals.prices, pegs: signals.pegs, verdict: signals.verdict },
          marketEnvironmentNote:
            signals === null ? "trade-signal environment unavailable" : undefined,
          resolvedComparable: history,
          resolvedComparableNote:
            history === null ? "resolved-market history unavailable" : undefined,
          computedAt: depth.computedAt,
        });
      } catch (err) {
        logger.error({ err, providerEventId }, "x402-intelligence: depth read failed");
        res.status(503).json({ error: "Market intelligence unavailable", code: "UNAVAILABLE" });
      }
    },
  );

  return router;
}

export const x402IntelligenceRouter = createX402IntelligenceRouter();
