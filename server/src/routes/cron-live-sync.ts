import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { activeBreakerState, liveProviderChainFor } from "../lib/sports/active-provider.ts";
import { feedFreshnessSnapshot } from "../lib/sports/ingest.ts";
import { refreshSlateWithFallback } from "../lib/sports/slate-fallback.ts";
import { refreshPlayByPlay, upsertEvents } from "../lib/sports/store.ts";
import { snapshotMarketPoolPrices } from "../lib/sports/market-metrics.ts";
import { runRegistryKeeper } from "../lib/sports/registry-keeper.ts";
import type { LeagueSlug } from "../lib/sports/provider.ts";
import { ARC_CHAIN_ID } from "../lib/chains.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";
import { evaluateAlerts } from "../lib/alerts.ts";
import { buildAlertInput, defaultOpsDeps } from "./ops-metrics.ts";
import { platformStatusReader } from "./platform-status.ts";
import { pushDeps } from "../lib/push/push-store.ts";
import { eventStatuses } from "../lib/push/live-alerts-db.ts";
import { runGameEventAlerts, runPositionAlerts } from "../lib/push/live-alerts-run.ts";
import { parseDates } from "./sports-slate.ts";

export const cronLiveSyncRouter = Router();

const LEAGUES: readonly LeagueSlug[] = ["nfl"];

/**
 * GET /api/cron/live-sync — Phase 7 / R-005: the game-time ingest tick.
 *
 * `/api/cron/sports-sync` is the daily housekeeping pass (reclaim, reband,
 * market creation, reference data, settlement) and runs once a day on the
 * Vercel Hobby cron — but the in-play buy halt (P-012, `IN_PLAY_FEED_MAX_AGE_MS`)
 * judges the feed by `events.last_polled_at`, which only that pass stamped.
 * Once a day means every live-game buy was halted outside a few minutes
 * per day. This route is the slice of the sync that keeps `last_polled_at`
 * fresh — slate fetch + upsert, the bounded play-by-play rotation, and the
 * pool-price snapshot — cheap enough to run every five minutes from the
 * GitHub Actions scheduler (`.github/workflows/live-sync.yml`), the same
 * secret-guarded pattern the autonomy loops use.
 *
 * Read-only for money: no signer, no market creation, no settlement, so
 * the kill switch (which exempts read-only crons) leaves it running — a
 * paused platform still shows live scores.
 */
cronLiveSyncRouter.get(
  "/api/cron/live-sync",
  requireCronSecret,
  async (req: Request, res: Response) => {
    // R-012 follow-up — `?dates=YYYYMMDD-YYYYMMDD` re-ingests a PAST window
    // (ESPN honours it) so games whose finals were missed while the feed
    // was dark get their status and scores captured: a status backfill,
    // no settlement (that is cron-resolution's job and needs the signer).
    const dates = parseDates(req.query.dates);
    if (dates !== null && typeof dates === "object") {
      res.status(400).json({ error: dates.error, code: "BAD_DATES" });
      return;
    }
    const results: Record<string, unknown> = {};
    let failures = 0;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const push = pushDeps(db);
    let feedDelayed = false;

    for (const league of LEAGUES) {
      try {
        // R-012: ESPN on a trial Sportradar key (quota), Sportradar with
        // ESPN behind it on a production key; the adapter that served the
        // slate also serves this tick's play-by-play.
        const {
          served: provider,
          refresh,
          skipped,
        } = await refreshSlateWithFallback(
          liveProviderChainFor(league),
          league,
          nowSeconds,
          undefined,
          dates ?? undefined,
        );
        // Task 071 (MX-004) — statuses before the write, so a kickoff or a
        // final is a transition this tick observed, not a re-read.
        const before = await eventStatuses(
          db,
          refresh.provider,
          refresh.events.map((e) => e.providerEventId),
        ).catch(() => []);
        const persisted: unknown = await upsertEvents(db, refresh.provider, league, refresh.events);
        const gameAlerts = await runGameEventAlerts(db, push, league, before, refresh.events).catch(
          (err: unknown) => {
            logger.warn({ league, err }, "live-sync: game-event push failed");
            return 0;
          },
        );
        let playByPlay: unknown = null;
        try {
          playByPlay = await refreshPlayByPlay(db, provider, league);
        } catch (err) {
          logger.warn({ league, err }, "live-sync: play-by-play pass failed");
          playByPlay = { error: err instanceof Error ? err.message : String(err) };
        }
        feedDelayed = feedDelayed || refresh.delayed;
        results[league] = {
          provider: refresh.provider,
          skippedProviders: skipped,
          ...(dates ? { backfillWindow: dates } : {}),
          delayed: refresh.delayed,
          events: persisted,
          playByPlay,
          gameAlerts,
        };
      } catch (err) {
        failures += 1;
        logger.error({ league, err }, "live-sync: league failed");
        results[league] = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    // K-01 — the registry keeper: every registered pool gets its model
    // probability / confidence / event state kept fresh inside §22's
    // staleness window, and a game observed final is written FINAL here,
    // before the daily resolution sweep freezes it (M-01 ordering).
    const keeper: unknown = await runRegistryKeeper(
      db,
      ARC_CHAIN_ID,
      nowSeconds,
      feedDelayed,
    ).catch((err: unknown) => {
      logger.warn({ err }, "live-sync: registry keeper failed");
      return { error: err instanceof Error ? err.message : String(err) };
    });

    const priceSnapshot: unknown = await snapshotMarketPoolPrices(db, ARC_CHAIN_ID)
      .then((snap) => snap ?? "disabled (markets not deployed on this chain)")
      .catch((err: unknown) => {
        logger.warn({ err }, "live-sync: pool-price snapshot failed");
        return { error: err instanceof Error ? err.message : String(err) };
      });

    // Task 071 (MX-004) — every held side checked against the pool price
    // just snapshotted; a 10¢ step from entry earns one push.
    const positionAlerts = await runPositionAlerts(db, push).catch((err: unknown) => {
      logger.warn({ err }, "live-sync: position-alert push failed");
      return 0;
    });

    // Phase 7 / R-010 — the paging hook: every tick evaluates the alert
    // policy and logs each firing alert as a structured `alert` event (the
    // line a log drain routes to a pager). warn+ only; info is for the
    // ops read.
    const alerts = await buildAlertInput({ ...defaultOpsDeps(), readStatus: platformStatusReader })
      .then(evaluateAlerts)
      .catch((err: unknown) => {
        logger.warn({ err }, "live-sync: alert evaluation failed");
        return [];
      });
    for (const a of alerts) {
      if (a.severity === "info") continue;
      logger[a.severity === "critical" ? "error" : "warn"](
        {
          event: "alert",
          alertId: a.id,
          severity: a.severity,
          title: a.title,
          detail: a.detail,
          runbook: a.runbook,
        },
        `alert: ${a.title}`,
      );
    }

    res.status(failures === LEAGUES.length ? 502 : 200).json({
      ok: failures < LEAGUES.length,
      breakers: activeBreakerState(),
      feeds: feedFreshnessSnapshot(),
      keeper,
      priceSnapshot,
      positionAlerts,
      alerts,
      leagues: results,
    });
  },
);
