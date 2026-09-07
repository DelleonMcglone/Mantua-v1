import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { activeBreakerState, providerFor } from "../lib/sports/active-provider.ts";
import { feedFreshnessSnapshot, refreshSlate } from "../lib/sports/ingest.ts";
import {
  listRebandCandidates,
  listReclaimCandidates,
  planMarketsFromCanonical,
  refreshPlayByPlay,
  refreshReferenceData,
  upsertEvents,
  upsertMarketRows,
} from "../lib/sports/store.ts";
import {
  createMarketsOnChain,
  rebandOpenMarkets,
  reclaimSettledMarkets,
  settleResolvedPositions,
} from "../lib/sports/markets-onchain.ts";
import { snapshotMarketPoolPrices } from "../lib/sports/market-metrics.ts";
import type { LeagueSlug } from "../lib/sports/provider.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "../lib/chains.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";

export const cronSportsSyncRouter = Router();

/** The covered leagues, per DM-105. Promotion is a data change elsewhere. */
const LEAGUES: readonly LeagueSlug[] = ["nfl", "wnba"];

/** Chains markets mint on — Base Mainnet. */
function marketChains(): SupportedChainId[] {
  return [BASE_CHAIN_ID];
}

/**
 * GET /api/cron/sports-sync — B3-005's slate-refresh pass. For each covered
 * league: fetch the slate through the resilient provider adapter, upsert the
 * normalized events, and plan markets FROM the persisted canonical rows
 * (P-002). The tick also runs the reclaim/reband sweeps, the P-006
 * position-settlement pass, and the P-011 pool-price snapshot.
 *
 * GET because Vercel Cron uses GET; guarded by the shared cron secret.
 *
 * **Market creation is now live** (factory deployed 2026-08-17): when
 * `MARKET_SIGNER_PRIVATE_KEY` is configured, each planned market gets an
 * idempotent `createMarketIfAbsent` — re-runs cannot duplicate, and games
 * already at kickoff are skipped (the factory reverts StartInPast). Without
 * the signer the route degrades to planning only, exactly as before.
 *
 * Failure isolation is per league: NFL being down must not stop WNBA syncing,
 * so each league catches independently and reports its own error.
 */
cronSportsSyncRouter.get(
  "/api/cron/sports-sync",
  requireCronSecret,
  async (_req: Request, res: Response) => {
    const results: Record<string, unknown> = {};
    let failures = 0;

    const chains = marketChains();
    // Recycle first: withdrawing seed LP + redeeming outcome tokens from
    // finished markets tops the signer back up, so today's seeding below
    // runs on yesterday's float instead of fresh top-ups.
    const reclaimed: Record<string, unknown> = {};
    for (const chainId of chains) {
      try {
        const candidates = await listReclaimCandidates(db, chainId);
        const r = await reclaimSettledMarkets(candidates, chainId);
        reclaimed[String(chainId)] = r ?? "disabled (no signer for this chain)";
      } catch (err) {
        logger.warn({ chainId, err }, "sports-sync: reclaim failed");
        reclaimed[String(chainId)] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    // Re-band next: thin books with no arbitrageurs can be pushed outside
    // the [0, 1] YES-price band; the signer arbs OPEN markets back inside
    // (split-and-sell above the band, buy-and-merge below) so the pool's
    // price is credible again before today's creation/seeding pass.
    const rebanded: Record<string, unknown> = {};
    for (const chainId of chains) {
      try {
        const candidates = await listRebandCandidates(db, chainId);
        const r = await rebandOpenMarkets(candidates, chainId);
        rebanded[String(chainId)] = r ?? "disabled (no signer for this chain)";
      } catch (err) {
        logger.warn({ chainId, err }, "sports-sync: reband failed");
        rebanded[String(chainId)] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    for (const league of LEAGUES) {
      try {
        // D-102/S-003: Sportradar (licensed) where configured and covering
        // the league; ESPN (prototyping fallback) otherwise. Selection is
        // per league — NFL can be on Sportradar while WNBA stays on ESPN.
        const provider = providerFor(league);
        const perChain: Record<string, unknown> = {};
        const nowSeconds = Math.floor(Date.now() / 1000);
        // One slate fetch per league feeds ingestion; planning happens
        // below, per chain, FROM the canonical rows this upsert persists
        // (P-002/041 rule: consumers read the DB, providers only feed
        // ingestion — the feed contributes labels and opening odds only).
        const refresh = await refreshSlate(provider, league, nowSeconds);
        const eventsPersisted: unknown = await upsertEvents(
          db,
          refresh.provider,
          league,
          refresh.events,
        );
        for (const chainId of chains) {
          // Market ids are chain-distinct (market-id.ts), so each chain
          // gets its own canonical plan against the same slate fetch.
          const plan = await planMarketsFromCanonical(
            db,
            refresh.provider,
            league,
            refresh.events,
            nowSeconds,
            chainId,
          );
          const creation = await createMarketsOnChain(plan.planned, chainId);
          // Markets rows must exist before settlement can log (FK): persist
          // everything the sweep touched, every tick.
          const marketRows = creation
            ? await upsertMarketRows(db, refresh.provider, creation.details, chainId)
            : 0;
          perChain[String(chainId)] = {
            marketRowsPersisted: marketRows,
            delayed: refresh.delayed,
            marketsPlanned: plan.planned.length,
            planSkipped: { noFeed: plan.skippedNoFeed, sideMismatch: plan.skippedSideMismatch },
            marketsOnChain: creation ?? "disabled (no signer for this chain)",
          };
        }
        // S-003: teams/players/injuries into the canonical tables, when the
        // provider offers the capabilities (Sportradar does; ESPN yields
        // all-null and the pass is a no-op). Failure here must not undo the
        // slate work above — reference data heals on the next tick.
        let reference: unknown = null;
        try {
          reference = await refreshReferenceData(db, provider, league);
        } catch (err) {
          logger.warn({ league, err }, "sports-sync: reference-data pass failed");
          reference = { error: err instanceof Error ? err.message : String(err) };
        }

        // Task 041: play-by-play for LIVE and just-finished games only, on a
        // bounded rotation (quota rule lives in selectPbpTargets). Null when
        // the provider has no pbp capability (ESPN). Failure never undoes
        // the slate work — the play log heals on the next tick.
        let playByPlay: unknown = null;
        try {
          playByPlay = await refreshPlayByPlay(db, provider, league);
        } catch (err) {
          logger.warn({ league, err }, "sports-sync: play-by-play pass failed");
          playByPlay = { error: err instanceof Error ? err.message : String(err) };
        }

        results[league] = { events: eventsPersisted, reference, playByPlay, chains: perChain };
      } catch (err) {
        failures += 1;
        logger.error({ league, err }, "sports-sync: league failed");
        results[league] = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    // P-006 — the post-resolution settlement pass: stamp settled prices on
    // the position mirror and auto-redeem agent-wallet (Circle DCW)
    // positions. Runs after reclaim so freshly-resolved markets settle on
    // the same tick that recycles their liquidity.
    const settlement: Record<string, unknown> = {};
    for (const chainId of chains) {
      try {
        settlement[String(chainId)] = await settleResolvedPositions(db, chainId);
      } catch (err) {
        logger.warn({ chainId, err }, "sports-sync: position settlement failed");
        settlement[String(chainId)] = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    // P-011 — periodic pool-price snapshot into `market_prices` (the tick
    // the chart/history/agent tools read between fills). Null means the
    // market stack isn't deployed on the chain — planning-only degrade,
    // like every other on-chain pass.
    const priceSnapshots: Record<string, unknown> = {};
    for (const chainId of chains) {
      try {
        const snap = await snapshotMarketPoolPrices(db, chainId);
        priceSnapshots[String(chainId)] = snap ?? "disabled (markets not deployed on this chain)";
      } catch (err) {
        logger.warn({ chainId, err }, "sports-sync: pool-price snapshot failed");
        priceSnapshots[String(chainId)] = {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    res.status(failures === LEAGUES.length ? 502 : 200).json({
      ok: failures < LEAGUES.length,
      breakers: activeBreakerState(),
      feeds: feedFreshnessSnapshot(),
      reclaimed,
      rebanded,
      settlement,
      priceSnapshots,
      leagues: results,
    });
  },
);
