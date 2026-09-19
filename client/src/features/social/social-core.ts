/**
 * Task 070 / AE-001, AE-006 — the pure half of the social settings panel:
 * the wire shapes of `/api/agent/social`, the template catalogue the user
 * approves from, handle validation (the same rule the server enforces),
 * and the wording of cadence and post status.
 */

export const POST_TEMPLATES = ["market_update", "explain_move", "price_signal"] as const;
export type PostTemplate = (typeof POST_TEMPLATES)[number];

export const TEMPLATE_INFO: Record<PostTemplate, { label: string; description: string }> = {
  market_update: {
    label: "Market update",
    description: "The price, the day's move and the pool for a game worth watching.",
  },
  explain_move: {
    label: "Explain the move",
    description:
      "Why a price moved: scoring, order flow, or a repricing the score does not explain.",
  },
  price_signal: {
    label: "Price as a signal",
    description: "What a move the scoreboard cannot explain implies about news not yet public.",
  },
};

export interface PostingPolicy {
  templates: PostTemplate[];
  maxPostsPerHour: number;
  maxPostsPerDay: number;
  minMinutesBetween: number;
  quietHoursUtc: { start: number; end: number } | null;
  requireApproval: boolean;
}

export interface SocialProfile {
  handle: string;
  displayName: string;
  bio: string;
  walletAddress: string;
  isPublic: boolean;
  platform: string;
  postingEnabled: boolean;
  postingPolicy: PostingPolicy;
  updatedAt: string;
}

export interface SocialResponse {
  profile: SocialProfile | null;
  pageUrl: string | null;
  platformConfigured: boolean;
}

export type PostStatus =
  | "posted"
  | "dry_run"
  | "pending_review"
  | "rejected_lint"
  | "rejected_user"
  | "failed";

export interface SocialPost {
  id: string;
  template: string;
  marketId: string | null;
  text: string;
  status: PostStatus;
  detail: Record<string, unknown>;
  externalId: string | null;
  createdAt: string;
}

export const HANDLE_RULE = /^[a-z0-9_]{3,24}$/;

/** The same rule the server applies, so the form can say no before the request. */
export function handleProblem(handle: string): string | null {
  if (handle.length < 3) return "At least 3 characters.";
  if (handle.length > 24) return "At most 24 characters.";
  if (!HANDLE_RULE.test(handle)) return "Lower-case letters, digits and underscores only.";
  return null;
}

/** One line describing the cadence the user has set. */
export function describeCadence(p: PostingPolicy): string {
  const parts = [
    `up to ${String(p.maxPostsPerHour)}/hour and ${String(p.maxPostsPerDay)}/day`,
    p.minMinutesBetween > 0
      ? `at least ${String(p.minMinutesBetween)} min apart`
      : "no minimum gap",
    p.quietHoursUtc
      ? `quiet ${String(p.quietHoursUtc.start).padStart(2, "0")}:00–${String(p.quietHoursUtc.end).padStart(2, "0")}:00 UTC`
      : "no quiet hours",
    p.requireApproval ? "each post waits for your approval" : "posts go out without review",
  ];
  return parts.join(" · ");
}

export const STATUS_LABELS: Record<PostStatus, string> = {
  posted: "Posted",
  dry_run: "Dry run (no credentials)",
  pending_review: "Awaiting your approval",
  rejected_lint: "Blocked by the compliance check",
  rejected_user: "Rejected by you",
  failed: "Failed at the platform",
};

/** The queue the user must act on, and everything else, newest first. */
export function splitPosts(posts: readonly SocialPost[]): {
  pending: SocialPost[];
  history: SocialPost[];
} {
  const sorted = [...posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    pending: sorted.filter((p) => p.status === "pending_review"),
    history: sorted.filter((p) => p.status !== "pending_review"),
  };
}

/** Lint violations from a rejected post's detail, as sentences. */
export function violationLines(post: SocialPost): string[] {
  const v = post.detail["violations"];
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (x): x is { rule: string; detail: string } =>
        typeof x === "object" && x !== null && "rule" in x,
    )
    .map((x) => `${x.rule.replace(/_/g, " ")}: ${x.detail}`);
}

/** Toggle one template in the approved list. */
export function toggleTemplate(
  templates: readonly PostTemplate[],
  t: PostTemplate,
): PostTemplate[] {
  return templates.includes(t) ? templates.filter((x) => x !== t) : [...templates, t];
}
