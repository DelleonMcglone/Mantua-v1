import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { EspnProvider } from "../lib/sports/espn.ts";
import { executeResolution, planResolution } from "../lib/sports/resolution.ts";
import {
  filterPlanToExistingMarkets,
  liveResolutionSubmitter,
  marketSignerWallet,
} from "../lib/sports/markets-onchain.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "../lib/chains.ts";
import { drizzleResolutionLog } from "../lib/sports/resolution-store.ts";
import type { LeagueSlug } from "../lib/sports/provider.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";
import { parseDates } from "./sports-slate.ts";

export const cronResolutionRouter = Router();

const espn = new EspnProvider();
const LEAGUES: readonly LeagueSlug[] = ["nfl", "wnba"];

/**
 * GET /api/cron/resolution — B4-003's settlement sweep.
 *
 * Reads each covered league's slate, plans freezes / resolves / voids, and —
 * once the Resolver contract is deployed and a signer configured — executes
 * them via `executeResolution` and records each action in the `resolutions`
 * table (B4-006).
 *
 * **Live when `MARKET_SIGNER_PRIVATE_KEY` is configured** (the Resolver
 * deployed 2026-08-17). Without the signer this stays a 503
 * RESOLUTION_DISABLED dry run — cron monitoring sees settlement as down
 * rather than silently succeeding at nothing, and the computed plan rides
 * along so operators can see what *would* have settled.
 *
 * The secondary provider is null until DM-107's vendor is chosen; with no
 * secondary configured, `decideSettlement`'s guards alone govern (its
 * corroboration policy activates the moment one is wired in).
 */
cronResolutionRouter.get(
  "/api/cron/resolution",
  requireCronSecret,
  async (req: Request, res: Response) => {
    // Optional ?dates=YYYYMMDD-YYYYMMDD: settle games from a past window
    // that already rotated off the provider's current scoreboard (e.g. the
    // sweep was down over their game day). Same validation as the slate.
    const dates = parseDates(req.query.dates);
    if (dates !== null && typeof dates === "object") {
      res.status(400).json({ error: dates.error, code: "BAD_DATES" });
      return;
    }
    const plans: Record<string, unknown> = {};
    let failures = 0;

    const chains: SupportedChainId[] = [BASE_CHAIN_ID];

    for (const league of LEAGUES) {
      try {
        const slate = await espn.getSlate(league, dates ?? undefined);
        const perChain: Record<string, unknown> = {};
        for (const chainId of chains) {
          const submitter = liveResolutionSubmitter(chainId);
          const log = submitter ? drizzleResolutionLog(db) : null;
          const plan = planResolution(slate, null, Math.floor(Date.now() / 1000), chainId);
          const planned = {
            delayed: slate.delayed,
            freezes: plan.freezes.length,
            resolves: plan.submissions.filter((s) => s.kind === "resolve").length,
            voids: plan.submissions.filter((s) => s.kind === "void").length,
            held: plan.held,
          };
          if (submitter && log) {
            // Only settle markets that were actually minted — games that
            // finished before creation went live have nothing on-chain.
            const live = await filterPlanToExistingMarkets(plan, chainId);
            const summary = await executeResolution(live, submitter, log, slate.provider);
            failures += summary.failures.length;
            perChain[String(chainId)] = {
              ...planned,
              onChainMarkets: live.submissions.length + live.freezes.length,
              executed: summary,
            };
          } else {
            perChain[String(chainId)] = planned;
          }
        }
        plans[league] = perChain;
      } catch (err) {
        failures += 1;
        logger.error({ league, err }, "resolution: pass failed");
        plans[league] = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    // Disabled only when NO chain has an authorised signer.
    if (!chains.some((c) => marketSignerWallet(c) !== null)) {
      res.status(503).json({
        error: "Resolution submission disabled — no chain has an authorised signer key",
        code: "RESOLUTION_DISABLED",
        dryRun: plans,
      });
      return;
    }
    res.status(failures > 0 ? 207 : 200).json({ ok: failures === 0, leagues: plans });
  },
);
