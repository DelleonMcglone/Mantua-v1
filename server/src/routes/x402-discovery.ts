import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import { composeDiscoverMarkets, type DiscoverRead } from "../lib/sports/market-discover.ts";
import { loadDiscoverAggregates } from "../lib/sports/market-discover-db.ts";
import type { LeagueSlug } from "../lib/sports/provider.ts";
import type { PublicSlate } from "../lib/sports/public-slate.ts";
import { withLiveOdds } from "../lib/sports/live-odds.ts";
import { readCanonicalPublicSlate } from "../lib/sports/store.ts";
import { getX402ServiceDef, parseCommaList, type X402ServiceDef } from "../lib/x402/catalog.ts";
import {
  x402PaywallDepsFromEnv,
  x402ServiceChain,
  type X402PaywallDeps,
} from "../middleware/x402-paywall.ts";

/**
 * Phase 17 (MP-005) — the PAID market-discovery service on /api/x402/v1:
 * the same public slate + liquidity + popularity read as the free
 * /api/markets/discover board (task 050), sold to external agents behind
 * the dual-rail paywall. A thin wrapper — the composer, the DB aggregates,
 * and the live-odds overlay are the existing libraries, unchanged.
 *
 * Filters: `league`/`sport` (Mantua's sports ARE its league slugs) and
 * `status`. Liquidity + popularity ride the DiscoverMarketWire fields.
 */

/** The covered leagues — the same allowlist the free discover read serves. */
const LEAGUES: readonly LeagueSlug[] = ["nfl"];

const leagueSchema = z.custom<LeagueSlug>((v) =>
  (LEAGUES as readonly string[]).includes(v as string),
);

const querySchema = z
  .object({
    league: leagueSchema.optional(),
    sport: leagueSchema.optional(),
    status: z.enum(["scheduled", "in_progress", "final"]).optional(),
  })
  .refine((q) => q.league === undefined || q.sport === undefined || q.league === q.sport, {
    message: "league and sport disagree",
  });

/** The discover read plus the per-league unavailability list. */
export type DiscoverReadWithUnavailable = DiscoverRead & { unavailable: string[] };

/** Seams for `createX402DiscoveryRouter` — the house factory-override pattern. */
export interface X402DiscoveryDeps {
  /** The canonical read for a resolved league list (slates + aggregates + compose). */
  read: (leagues: readonly LeagueSlug[]) => Promise<DiscoverReadWithUnavailable>;
  /** Paywall construction inputs (env in production; inline in tests). */
  paywall: X402PaywallDeps;
}

/** The paid discovery service, by catalog id. */
const DISCOVERY_DEF = getX402ServiceDef("market-discovery") as X402ServiceDef;

/** The free discover route's assembly, verbatim — this service's whole read. */
async function readDiscover(leagues: readonly LeagueSlug[]): Promise<DiscoverReadWithUnavailable> {
  const slates: PublicSlate[] = [];
  const failed: string[] = [];
  await Promise.all(
    leagues.map(async (league) => {
      try {
        slates.push(await withLiveOdds(await readCanonicalPublicSlate(db, league)));
      } catch (err) {
        logger.warn({ league, err }, "x402-discovery: canonical read failed");
        failed.push(league);
      }
    }),
  );
  const ids = slates.flatMap((s) => s.events.map((e) => e.providerEventId));
  const aggregates = await loadDiscoverAggregates(db, ids);
  return { ...composeDiscoverMarkets(slates, aggregates), unavailable: failed };
}

export function createX402DiscoveryRouter(overrides: Partial<X402DiscoveryDeps> = {}): Router {
  const deps: X402DiscoveryDeps = {
    read: overrides.read ?? readDiscover,
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
   * GET /api/x402/v1/markets/discover — the paid market-discovery read
   * (MP-005). Unpaid requests 402 at the paywall; a paid request filters
   * the composed slate. An unfiltered read (no league/sport/status) is the
   * full board across the covered leagues.
   */
  router.get(
    DISCOVERY_DEF.path,
    ...x402ServiceChain(DISCOVERY_DEF, deps.paywall),
    async (req: Request, res: Response) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Invalid filter", code: "BAD_REQUEST", details: parsed.error.issues });
        return;
      }
      const league = parsed.data.league ?? parsed.data.sport;
      const leagues = league === undefined ? LEAGUES : [league];
      try {
        const read = await deps.read(leagues);
        const markets = parsed.data.status
          ? read.markets.filter((m) => m.status === parsed.data.status)
          : read.markets;
        res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=30");
        res.json({ ...read, markets });
      } catch (err) {
        logger.error({ err, leagues }, "x402-discovery: read failed");
        res.status(503).json({ error: "Markets unavailable", code: "UNAVAILABLE" });
      }
    },
  );

  return router;
}

export const x402DiscoveryRouter = createX402DiscoveryRouter();
