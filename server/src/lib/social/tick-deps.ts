import type { DB } from "../../db/client.ts";
import type { AgentSocialProfile } from "../../db/schema/social.ts";
import { env } from "../../env.ts";
import { logAudit } from "../audit.ts";
import { readCandidateMarkets, type CandidateMarket } from "./candidates.ts";
import type { PostRunDeps, PostRunProfile } from "./post-run.ts";
import { listPosts, recordPost } from "./post-store.ts";
import { policyFromJson } from "./posting-policy.ts";
import { composePosts } from "./templates.ts";
import { postToX, xCredentialsFromEnv } from "./x-client.ts";

/**
 * Task 070 — the production wiring of `runPostingTick`: candidates from
 * the canonical tables, the cadence and de-duplication reads from the post
 * record, the X client when the deployment has credentials, and a record
 * plus audit row for every attempt.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Statuses that consumed the cadence or hold a slot in the review queue. */
const CADENCE_STATUSES = ["posted", "pending_review", "dry_run"] as const;
/** Statuses that make the same market/template pair not worth repeating today —
 *  including a lint rejection (the same text would fail again) and a platform
 *  failure (one attempt per pair per day). */
const COVERED_STATUSES = [
  "posted",
  "pending_review",
  "dry_run",
  "rejected_user",
  "rejected_lint",
  "failed",
] as const;

/** One candidate read per tick, shared by every profile the tick serves. */
export type CandidateReader = (nowSeconds: number) => Promise<CandidateMarket[]>;
export function sharedCandidateReader(db: DB): CandidateReader {
  let cached: { nowSeconds: number; promise: Promise<CandidateMarket[]> } | null = null;
  return (nowSeconds) => {
    if (!cached || cached.nowSeconds !== nowSeconds) {
      cached = { nowSeconds, promise: readCandidateMarkets(db, nowSeconds) };
    }
    return cached.promise;
  };
}

export function publicPageUrl(handle: string): string {
  return `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/agents/${handle}`;
}

export function tickProfile(row: AgentSocialProfile): PostRunProfile {
  return {
    id: row.id,
    handle: row.handle,
    postingEnabled: row.postingEnabled,
    policy: policyFromJson(row.postingPolicy),
  };
}

/** The sender, or null when the deployment holds no credentials (dry run). */
export function platformSender(): PostRunDeps["send"] {
  const creds = xCredentialsFromEnv(env);
  if (!creds) return null;
  return (text) => postToX(creds, text, { fetch: (url, init) => fetch(url, init) });
}

export function buildTickDeps(
  db: DB,
  row: AgentSocialProfile,
  now: () => Date = () => new Date(),
  readCandidates: CandidateReader = (nowSeconds) => readCandidateMarkets(db, nowSeconds),
): PostRunDeps {
  const pageUrl = publicPageUrl(row.handle);
  // The covered set is loaded once per profile per tick, not once per candidate.
  let covered: Promise<{ marketId: string | null; template: string }[]> | null = null;
  return {
    now,
    candidates: async (profile) => {
      const nowSeconds = Math.floor(now().getTime() / 1000);
      const candidates = await readCandidates(nowSeconds);
      return candidates.flatMap((c) =>
        composePosts(
          { ...c.facts, agentName: row.displayName, pageUrl },
          c.move,
          c.signal,
          profile.policy.templates,
        ),
      );
    },
    recentPostTimes: async (profileId) => {
      const rows = await listPosts(db, profileId, {
        statuses: CADENCE_STATUSES,
        since: new Date(now().getTime() - DAY_MS),
        limit: 200,
      });
      return rows.map((r) => r.createdAt);
    },
    alreadyCovered: async (profileId, marketId, template) => {
      covered ??= listPosts(db, profileId, {
        statuses: COVERED_STATUSES,
        since: new Date(now().getTime() - DAY_MS),
        limit: 200,
      });
      return (await covered).some((r) => r.marketId === marketId && r.template === template);
    },
    send: platformSender(),
    record: async (post) => {
      const saved = await recordPost(db, {
        profileId: row.id,
        template: post.template,
        marketId: post.marketId,
        text: post.text,
        status: post.status,
        detail: post.detail,
        externalId: post.externalId ?? null,
      });
      await logAudit({
        walletAddress: row.walletAddress,
        action: "social_post",
        outcome:
          post.status === "posted" || post.status === "dry_run" ? "success" : "rejected_other",
        params: {
          postId: saved.id,
          template: post.template,
          marketId: post.marketId,
          status: post.status,
        },
        reason:
          post.status === "failed"
            ? typeof post.detail["error"] === "string"
              ? post.detail["error"]
              : "failed"
            : undefined,
      });
    },
  };
}
