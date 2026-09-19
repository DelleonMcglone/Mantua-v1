import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { runPostingTick, type PostRunSummary } from "../lib/social/post-run.ts";
import { listPostingProfiles } from "../lib/social/profile-store.ts";
import {
  buildTickDeps,
  platformSender,
  sharedCandidateReader,
  tickProfile,
} from "../lib/social/tick-deps.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";

/**
 * Task 070 / AE-002 … AE-006 — GET /api/cron/social-posts: the posting tick.
 *
 * Every profile with posting enabled gets one `runPostingTick`: compose
 * for the markets worth a post, lint, de-duplicate, apply the user's
 * cadence and approval setting, then send through the deployment's X
 * account or record a dry run. Runs from the GitHub Actions scheduler
 * (`.github/workflows/social-posts.yml`) every fifteen minutes behind the
 * cron secret, the same pattern as live-sync. Read-only for money, so the
 * kill switch's read-only exemption applies; a paused platform still
 * explains its prices.
 */
export const cronSocialPostsRouter = Router();

cronSocialPostsRouter.get(
  "/api/cron/social-posts",
  requireCronSecret,
  async (_req: Request, res: Response) => {
    const started = Date.now();
    const summaries: PostRunSummary[] = [];
    const failures: { profileId: string; error: string }[] = [];
    let profiles;
    try {
      profiles = await listPostingProfiles(db);
    } catch (err) {
      logger.error({ err }, "social-posts: profile listing failed");
      res.status(500).json({ error: "Failed to list profiles", code: "INTERNAL" });
      return;
    }
    const readCandidates = sharedCandidateReader(db);
    const now = () => new Date(Math.floor(started / 1000) * 1000);
    for (const row of profiles) {
      try {
        summaries.push(
          await runPostingTick(tickProfile(row), buildTickDeps(db, row, now, readCandidates)),
        );
      } catch (err) {
        logger.error({ err, profileId: row.id }, "social-posts: profile tick failed");
        failures.push({
          profileId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    res.json({
      ok: failures.length === 0,
      platformConfigured: platformSender() !== null,
      profiles: profiles.length,
      summaries,
      failures,
      durationMs: Date.now() - started,
    });
  },
);
