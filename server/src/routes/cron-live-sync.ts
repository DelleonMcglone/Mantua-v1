import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { activeBreakerState, providerFor } from "../lib/sports/active-provider.ts";
import { feedFreshnessSnapshot, refreshSlate } from "../lib/sports/ingest.ts";
import { refreshPlayByPlay, upsertEvents } from "../lib/sports/store.ts";
import { snapshotMarketPoolPrices } from "../lib/sports/market-metrics.ts";
import type { LeagueSlug } from "../lib/sports/provider.ts";
import { BASE_CHAIN_ID } from "../lib/chains.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";
import { evaluateAlerts } from "../lib/alerts.ts";
import { buildAlertInput, defaultOpsDeps } from "./ops-metrics.ts";
import { platformStatusReader } from "./platform-status.ts";

export const cronLiveSyncRouter = Router();

const LEAGUES: readonly LeagueSlug[] = ["nfl", "wnba"];

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
  async (_req: Request, res: Response) => {
    const results: Record<string, unknown> = {};
    let failures = 0;
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (const league of LEAGUES) {
      try {
        const provider = providerFor(league);
        const refresh = await refreshSlate(provider, league, nowSeconds);
        const persisted: unknown = await upsertEvents(db, refresh.provider, league, refresh.events);
        let playByPlay: unknown = null;
        try {
          playByPlay = await refreshPlayByPlay(db, provider, league);
        } catch (err) {
          logger.warn({ league, err }, "live-sync: play-by-play pass failed");
          playByPlay = { error: err instanceof Error ? err.message : String(err) };
        }
        results[league] = { delayed: refresh.delayed, events: persisted, playByPlay };
      } catch (err) {
        failures += 1;
        logger.error({ league, err }, "live-sync: league failed");
        results[league] = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    const priceSnapshot: unknown = await snapshotMarketPoolPrices(db, BASE_CHAIN_ID)
      .then((snap) => snap ?? "disabled (markets not deployed on this chain)")
      .catch((err: unknown) => {
        logger.warn({ err }, "live-sync: pool-price snapshot failed");
        return { error: err instanceof Error ? err.message : String(err) };
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
      priceSnapshot,
      alerts,
      leagues: results,
    });
  },
);
