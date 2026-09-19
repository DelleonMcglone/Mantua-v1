import { lintPost } from "./compliance.ts";
import { canPostNow, templateApproved } from "./posting-policy.ts";

/**
 * Task 070 / AE-002 … AE-006 — one scheduler tick for one profile. Every
 * dependency is injected so the whole gate sequence is unit-tested:
 *
 *   candidate → approved template? → not already covered? → lint →
 *   cadence (counting this tick's own sends) → approval setting →
 *   send | dry run → record
 *
 * Every attempt is recorded, whatever happened to it. The public page
 * renders the `posted` ones; the rest are the operator's trail.
 */

export type {
  CandidatePost,
  PostRecord,
  PostRunDeps,
  PostRunProfile,
  PostRunSummary,
  PostStatus,
} from "./post-run-types.ts";
import type { PostRunDeps, PostRunProfile, PostRunSummary } from "./post-run-types.ts";

export async function runPostingTick(
  profile: PostRunProfile,
  deps: PostRunDeps,
): Promise<PostRunSummary> {
  const summary: PostRunSummary = {
    profileId: profile.id,
    handle: profile.handle,
    composed: 0,
    posted: 0,
    dryRun: 0,
    pendingReview: 0,
    rejectedLint: 0,
    failed: 0,
    skipped: {},
  };
  const skip = (reason: string): void => {
    summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
  };
  if (!profile.postingEnabled || profile.policy.templates.length === 0) {
    skip("disabled");
    return summary;
  }
  const now = deps.now();
  const times = [...(await deps.recentPostTimes(profile.id))];
  for (const candidate of await deps.candidates(profile)) {
    summary.composed += 1;
    const base = {
      template: candidate.template,
      marketId: candidate.marketId,
      text: candidate.text,
    };
    if (!templateApproved(profile.policy, candidate.template)) {
      skip("unapproved_template");
      continue;
    }
    if (await deps.alreadyCovered(profile.id, candidate.marketId, candidate.template)) {
      skip("duplicate");
      continue;
    }
    const lint = lintPost(candidate.text, { ledgerFigures: [] });
    if (!lint.ok) {
      summary.rejectedLint += 1;
      await deps.record({
        ...base,
        status: "rejected_lint",
        detail: { violations: lint.violations },
      });
      continue;
    }
    const cadence = canPostNow(profile.policy, times, now);
    if (!cadence.ok) {
      skip(cadence.reason);
      continue;
    }
    if (profile.policy.requireApproval) {
      summary.pendingReview += 1;
      times.push(now);
      await deps.record({ ...base, status: "pending_review", detail: {} });
      continue;
    }
    if (!deps.send) {
      summary.dryRun += 1;
      times.push(now);
      await deps.record({
        ...base,
        status: "dry_run",
        detail: { reason: "no platform credentials" },
      });
      continue;
    }
    const result = await deps.send(candidate.text);
    if (result.ok) {
      summary.posted += 1;
      times.push(now);
      await deps.record({ ...base, status: "posted", detail: {}, externalId: result.id });
    } else {
      summary.failed += 1;
      await deps.record({
        ...base,
        status: "failed",
        detail: { status: result.status, error: result.error },
      });
    }
  }
  return summary;
}
