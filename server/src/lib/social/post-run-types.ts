import type { PostingPolicy, PostTemplate } from "./posting-policy.ts";
import type { XPostResult } from "./x-client.ts";

/**
 * Task 070 / AE-002 … AE-006 — the shapes of one posting tick
 * (`post-run.ts` runs it): a composed candidate, the profile it runs for,
 * the record of every attempt, the injected dependencies, and the summary.
 */

export interface CandidatePost {
  template: PostTemplate;
  marketId: string;
  text: string;
}

export interface PostRunProfile {
  id: string;
  handle: string;
  postingEnabled: boolean;
  policy: PostingPolicy;
}

export type PostStatus =
  | "posted"
  | "dry_run"
  | "pending_review"
  | "rejected_lint"
  | "rejected_user"
  | "failed";

export interface PostRecord {
  template: PostTemplate;
  marketId: string | null;
  text: string;
  status: PostStatus;
  detail: Record<string, unknown>;
  externalId?: string | null | undefined;
}

export interface PostRunDeps {
  now: () => Date;
  /** Posts worth making for this profile right now (already composed). */
  candidates: (profile: PostRunProfile) => Promise<CandidatePost[]>;
  /** Times of this profile's recent posts that count toward the cadence. */
  recentPostTimes: (profileId: string) => Promise<Date[]>;
  /** The same market/template pair was posted or queued within the window. */
  alreadyCovered: (profileId: string, marketId: string, template: PostTemplate) => Promise<boolean>;
  /** Null when the deployment has no credentials — every post is a dry run. */
  send: ((text: string) => Promise<XPostResult>) | null;
  record: (row: PostRecord) => Promise<void>;
}

export interface PostRunSummary {
  profileId: string;
  handle: string;
  composed: number;
  posted: number;
  dryRun: number;
  pendingReview: number;
  rejectedLint: number;
  failed: number;
  skipped: Record<string, number>;
}
