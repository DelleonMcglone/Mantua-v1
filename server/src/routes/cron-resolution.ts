import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { logAudit } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { providerFor } from "../lib/sports/active-provider.ts";
import { executeResolution, planResolution } from "../lib/sports/resolution.ts";
import { checkFeedFreshness } from "../lib/sports/resolution-freshness.ts";
import {
  filterPlanToExistingMarkets,
  liveResolutionSubmitter,
  marketSignerWallet,
} from "../lib/sports/markets-onchain.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "../lib/chains.ts";
import {
  drizzleDisputeWindow,
  drizzleResolutionLog,
  loadDisputeWindows,
  loadStoredEvents,
  syncConfidenceReviews,
} from "../lib/sports/resolution-store.ts";
import type { LeagueSlug, ProviderSlate, SportsDataProvider } from "../lib/sports/provider.ts";
import { runComboSettlement } from "../lib/combos/combo-resolution-run.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";
import { parseDates } from "./sports-slate.ts";

export const cronResolutionRouter = Router();

const LEAGUES: readonly LeagueSlug[] = ["nfl", "wnba"];

/**
 * D-104 — settlement reads the SAME canonical provider routing as every
 * other consumer: `providerFor(league)` (Sportradar where configured and
 * covering the league, ESPN only as the configured fallback). The previous
 * direct `new EspnProvider()` meant finals settled off the prototyping
 * fallback even where the licensed provider was configured — and off a
 * different provider than the ingest store the S-022 reconciliation
 * precheck compares against. Exported so tests can pin the routing.
 */
export function resolutionProviderFor(league: LeagueSlug): SportsDataProvider {
  return providerFor(league);
}

/**
 * Fetch the settlement slate. The optional `?dates=` backfill window is an
 * ESPN-adapter capability (`EspnProvider.getSlate(league, dates?)`) that the
 * `SportsDataProvider` interface does not carry; passing it through the
 * structural call below is a no-op for adapters that ignore it, and we warn
 * loudly rather than pretend a Sportradar-served league was backfilled.
 */
async function resolutionSlateFor(
  league: LeagueSlug,
  dates: string | null,
): Promise<ProviderSlate> {
  const provider = resolutionProviderFor(league);
  if (dates !== null && provider.name !== "espn") {
    logger.warn(
      { league, provider: provider.name, dates },
      "resolution: ?dates= backfill is only honoured by the espn adapter — sweeping the current slate",
    );
  }
  const getSlate: (league: LeagueSlug, dates?: string) => Promise<ProviderSlate> =
    provider.getSlate.bind(provider);
  return getSlate(league, dates ?? undefined);
}

/**
 * GET /api/cron/resolution — B4-003's settlement sweep, hardened by task 040.
 *
 * Reads each covered league's slate, plans freezes / resolves / voids, and —
 * once the Resolver contract is deployed and a signer configured — executes
 * them via `executeResolution` and records each action in the `resolutions`
 * table (B4-006), now with the full S-026 evidence bundle.
 *
 * Task-040 pipeline, in order:
 *  1. S-022 stale-data breaker: a slate that is delayed or older than
 *     MAX_RESOLUTION_FEED_AGE_MS is demoted to `delayed` before planning —
 *     freezes still sweep (finality is monotonic, so a stale `final` cannot
 *     close a market that is still live), settlement holds — with a loud log
 *     + audit row.
 *  2. S-024: each final's assessment advances the persisted confidence state
 *     machine (`resolution_reviews`); timed-out PENDING rows escalate to
 *     MANUAL_REVIEW; DISPUTED/MANUAL_REVIEW never reach the submitter.
 *  3. S-025: every resolve passes `assertResolutionCriteria` inside
 *     `executeResolution` — refusals surface as `rejected` with the failed
 *     criteria, audited as `rejected_other`.
 *  4. D-104 (task 044): a mandatory dispute window
 *     (`RESOLUTION_DISPUTE_WINDOW_SECONDS`) separates the gate passing from
 *     the on-chain submit. The first pass that clears the gate opens the
 *     window (audited, no submit); later passes submit only once it has
 *     elapsed, the outcome is still VERIFIED, and no operator hold (ops
 *     route) is set. A DISPUTED escalation cancels the window. Voids are
 *     window-exempt (B4-005).
 *
 * **Live when `MARKET_SIGNER_PRIVATE_KEY` is configured** (the Resolver
 * deployed 2026-08-17). Without the signer this stays a 503
 * RESOLUTION_DISABLED dry run — cron monitoring sees settlement as down
 * rather than silently succeeding at nothing, and the computed plan rides
 * along so operators can see what *would* have settled.
 *
 * The secondary provider is null until DM-107's vendor is chosen; the
 * criteria gate and evidence bundles record that single-source policy
 * explicitly (the corroboration policy activates the moment one is wired in).
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
        const slate = await resolutionSlateFor(league, dates);
        const nowMs = Date.now();
        const nowSeconds = Math.floor(nowMs / 1000);

        // S-022 — the stale-data circuit breaker. Not fresh → treat exactly
        // like a delayed slate: the D-103 freeze sweep proceeds (it closes on
        // a `final` or the 12 h backstop, and neither can be wrong on stale
        // data the way a settlement can — finals do not un-happen and the
        // backstop is pure clock), settlement refuses, and the refusal is
        // loud.
        const freshness = checkFeedFreshness(slate, nowMs);
        if (!freshness.fresh) {
          logger.error(
            { league, provider: slate.provider, lagMs: freshness.lagMs, reason: freshness.reason },
            "resolution: stale-data breaker tripped — holding all settlement this pass",
          );
          await logAudit({
            action: "market_resolution",
            outcome: "rejected_other",
            reason: `stale-feed breaker (${league}): ${freshness.reason ?? "not fresh"}`,
            params: { league, provider: slate.provider, lagMs: freshness.lagMs },
          });
        }
        const effectiveSlate = freshness.fresh ? slate : { ...slate, delayed: true };

        const perChain: Record<string, unknown> = {};
        for (const chainId of chains) {
          const submitter = liveResolutionSubmitter(chainId);
          const log = submitter ? drizzleResolutionLog(db, chainId) : null;
          const plan = planResolution(effectiveSlate, null, nowSeconds, chainId);

          // S-024 — advance the persisted confidence machine on this pass's
          // assessments and sweep the reconciliation timeout. Runs in dry-run
          // mode too: disputes must be recorded even when nothing can sign.
          const reviews = await syncConfidenceReviews(db, plan.assessments, {
            chainId,
            now: new Date(nowMs),
          });

          const planned = {
            delayed: effectiveSlate.delayed,
            feed: { lagMs: freshness.lagMs, fresh: freshness.fresh, reason: freshness.reason },
            freezes: plan.freezes.length,
            resolves: plan.submissions.filter((s) => s.kind === "resolve").length,
            voids: plan.submissions.filter((s) => s.kind === "void").length,
            held: plan.held,
            reviews: {
              changed: reviews.changed,
              escalated: reviews.escalated,
            },
          };
          if (submitter && log) {
            // Only settle markets that were actually minted — games that
            // finished before creation went live have nothing on-chain.
            const live = await filterPlanToExistingMarkets(plan, chainId);
            // S-022 — reconciliation precheck inputs: the ingest store's own
            // view of every event this pass wants to settle.
            const liveEventIds = [...new Set(live.submissions.map((s) => s.providerEventId))];
            const stored = await loadStoredEvents(db, slate.provider, liveEventIds);
            // D-104 — the mandatory dispute window between the criteria
            // gate and the on-chain submit. Preloaded from the review rows;
            // the executor opens/checks it per game outcome.
            const windowGate = drizzleDisputeWindow(
              db,
              chainId,
              env.RESOLUTION_DISPUTE_WINDOW_SECONDS,
              await loadDisputeWindows(db, chainId, liveEventIds),
            );
            const summary = await executeResolution(live, submitter, log, slate.provider, {
              nowSeconds,
              confidenceOf: (id) => reviews.states.get(id) ?? null,
              storedEventOf: (id) => stored.get(id) ?? null,
              disputeWindow: windowGate,
              onWindowEvent: async (evt) => {
                if (evt.kind === "awaiting") return; // informational — no ink
                const reasons = {
                  opened: `dispute window opened — closes ${evt.closesAt.toISOString()}`,
                  held: `operator hold active — not submitting: ${evt.holdNote ?? "(no note)"}`,
                  elapsed: "dispute window elapsed and outcome still VERIFIED — submitting",
                } as const;
                await logAudit({
                  action: "market_resolution",
                  outcome: evt.kind === "held" ? "rejected_other" : "pending",
                  reason: reasons[evt.kind],
                  params: {
                    providerEventId: evt.providerEventId,
                    marketId: evt.marketId,
                    disputeWindowOpensAt: evt.opensAt.toISOString(),
                    disputeWindowClosesAt: evt.closesAt.toISOString(),
                    windowSeconds: env.RESOLUTION_DISPUTE_WINDOW_SECONDS,
                  },
                  chainId,
                });
              },
              onRejected: async (rejection) => {
                await logAudit({
                  action: "market_resolution",
                  outcome: "rejected_other",
                  reason: `criteria gate refused resolve: ${rejection.failed
                    .map((c) => c.name)
                    .join(", ")}`,
                  params: {
                    marketId: rejection.marketId,
                    providerEventId: rejection.providerEventId,
                    failed: rejection.failed,
                  },
                  chainId,
                });
              },
            });
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

    // Task 072 (CB-007) — combo markets settle from their legs' on-chain
    // outcomes, after the leg pass above; the stamps land even without a
    // signer, the resolver actions report as the dry-run plan.
    const combos: Record<string, unknown> = {};
    for (const chainId of chains) {
      try {
        combos[String(chainId)] = await runComboSettlement(
          db,
          chainId,
          Math.floor(Date.now() / 1000),
          liveResolutionSubmitter(chainId),
        );
      } catch (err) {
        failures += 1;
        logger.error({ chainId, err }, "resolution: combo pass failed");
        combos[String(chainId)] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    plans["combos"] = combos;

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
