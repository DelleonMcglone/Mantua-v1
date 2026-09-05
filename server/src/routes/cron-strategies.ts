import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { logger } from "../lib/logger.ts";
import { EspnProvider } from "../lib/sports/espn.ts";
import { ticksFromSlates } from "../lib/sports/strategies.ts";
import {
  overlayPoolTicks,
  processStrategy,
  referencedMarketIds,
} from "../lib/sports/strategy-engine.ts";
import { listArmed } from "../lib/sports/strategy-store.ts";
import type { LeagueSlug } from "../lib/sports/provider.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";

export const cronStrategiesRouter = Router();

const espn = new EspnProvider();
const LEAGUES: readonly LeagueSlug[] = ["nfl", "wnba"];

/**
 * GET /api/cron/strategies — B9-005's evaluation + execution tick.
 *
 * Loads every armed strategy and evaluates it against BOTH tick classes:
 * game-state ticks (freeze at kickoff / in-progress / final, resolution —
 * from the non-delayed slates) and price ticks (the pool's OWN price where
 * one trades, overlaid per event; the provider line only as the pre-trading
 * seed; a failed pool read drops the price so nothing fires on stale data).
 *
 * Per strategy the engine (strategy-engine.ts): auto-disarms per B9-007
 * (kickoff freeze, resolution, expiry, kill switch, unparseable config);
 * claims armed→triggered atomically before executing so overlapping crons
 * can't double-execute; closes through the capped agent path (strategy
 * capUsd + the wallet's daily cap both bind, C-015 receipt before
 * `executed`); releases retryable holds/bounded failures back to armed.
 * Positions held in the user's own wallet trigger and record but wait for
 * the user's click; delta-hedge rebalances still hold.
 */
cronStrategiesRouter.get(
  "/api/cron/strategies",
  requireCronSecret,
  async (_req: Request, res: Response) => {
    const killed = env.STRATEGIES_KILL_SWITCH;
    const now = Math.floor(Date.now() / 1000);

    let armed;
    try {
      armed = await listArmed(db);
    } catch (err) {
      logger.error({ err }, "strategies: load failed");
      res.status(500).json({ error: "Failed to load strategies", code: "INTERNAL" });
      return;
    }
    if (armed.length === 0) {
      res.json({ ok: true, armed: 0, killed, decisions: [] });
      return;
    }

    const slates = [];
    for (const league of LEAGUES) {
      try {
        slates.push(await espn.getSlate(league));
      } catch (err) {
        logger.warn({ league, err }, "strategies: slate fetch failed");
      }
    }
    const ticks = await overlayPoolTicks(
      ticksFromSlates(slates, now),
      slates,
      referencedMarketIds(armed),
    );

    const decisions: unknown[] = [];
    for (const row of armed) {
      try {
        decisions.push(await processStrategy(db, row, ticks, now, killed));
      } catch (err) {
        // One strategy's infrastructure failure (cap-ledger outage, DB
        // hiccup) must not starve the rest of the sweep.
        logger.error({ strategyId: row.id, err }, "strategies: processing failed");
        decisions.push({ id: row.id, decision: "error" });
      }
    }

    res.json({ ok: true, armed: armed.length, killed, decisions });
  },
);
