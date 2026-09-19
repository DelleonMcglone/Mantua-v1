import type { DB } from "../../db/client.ts";
import type { AgentSocialProfile, SocialPost } from "../../db/schema/social.ts";
import { logAudit } from "../audit.ts";
import { claimPendingPost, setPostStatus } from "./post-store.ts";
import type { PostRunDeps } from "./post-run.ts";

/**
 * Task 070 / AE-006 — the user's decision on a post that waited for
 * approval. The row is first claimed atomically (`pending_review` →
 * `sending`), so two concurrent approvals cannot both reach the platform;
 * approve then sends through the platform sender (or records a dry run
 * when the deployment has none); reject keeps it in the record marked as
 * the user's decision. Either way the row is updated, never deleted, and
 * the decision is audited.
 */

export type DecisionStatus = "posted" | "dry_run" | "failed" | "rejected_user";

export interface DecisionResult {
  id: string;
  status: DecisionStatus;
  externalId: string | null;
}

/** Null when the post was no longer pending (a concurrent decision won). */
export async function decidePost(
  db: DB,
  profile: AgentSocialProfile,
  post: SocialPost,
  approve: boolean,
  send: PostRunDeps["send"],
): Promise<DecisionResult | null> {
  if (!(await claimPendingPost(db, post.id, profile.id))) return null;
  let status: DecisionStatus = "rejected_user";
  let detail: Record<string, unknown> = { decidedAt: new Date().toISOString() };
  let externalId: string | null = null;
  if (approve) {
    const result = send ? await send(post.text) : null;
    if (!result) status = "dry_run";
    else if (result.ok) {
      status = "posted";
      externalId = result.id;
    } else {
      status = "failed";
      detail = { ...detail, status: result.status, error: result.error };
    }
  }
  await setPostStatus(db, post.id, status, detail, externalId);
  await logAudit({
    walletAddress: profile.walletAddress,
    action: "social_post",
    outcome: status === "failed" ? "failure" : "success",
    params: { postId: post.id, template: post.template, marketId: post.marketId, status, approve },
  });
  return { id: post.id, status, externalId };
}
