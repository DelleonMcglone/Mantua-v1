import { z } from "zod";

/**
 * Task 070 / AE-006 — the user's posting policy over their agent's voice:
 * which templates it may use, how often it may post, when it must stay
 * quiet, and whether each post waits for the user's approval. Stored as
 * jsonb on `agent_social_profiles.posting_policy`; absent keys take the
 * defaults, so an older row stays valid as the policy grows.
 *
 * Every gate here is code the scheduler runs before a post can leave. A
 * template the user has not approved never posts; the cadence is a hard
 * ceiling, not a target.
 */

export const POST_TEMPLATES = ["market_update", "explain_move", "price_signal"] as const;
export type PostTemplate = (typeof POST_TEMPLATES)[number];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const postingPolicySchema = z
  .object({
    /** Templates the user approved; empty = the agent posts nothing. */
    templates: z.array(z.enum(POST_TEMPLATES)).max(POST_TEMPLATES.length),
    maxPostsPerHour: z.number().int().min(0).max(12),
    maxPostsPerDay: z.number().int().min(0).max(48),
    minMinutesBetween: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
    /** UTC hours during which nothing posts; `start > end` wraps midnight. */
    quietHoursUtc: z
      .object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(23) })
      .strict()
      .nullable(),
    /** Each composed post waits in `pending_review` for the user. */
    requireApproval: z.boolean(),
  })
  .strict();
export type PostingPolicy = z.infer<typeof postingPolicySchema>;

export const DEFAULT_POSTING_POLICY: PostingPolicy = {
  templates: [],
  maxPostsPerHour: 2,
  maxPostsPerDay: 8,
  minMinutesBetween: 20,
  quietHoursUtc: null,
  requireApproval: true,
};

export const postingPolicyPatchSchema = postingPolicySchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });
export type PostingPolicyPatch = z.infer<typeof postingPolicyPatchSchema>;

/** The stored jsonb, merged over the defaults; invalid keys fall back per key. */
export function policyFromJson(value: unknown): PostingPolicy {
  if (!value || typeof value !== "object") return { ...DEFAULT_POSTING_POLICY };
  const out: PostingPolicy = { ...DEFAULT_POSTING_POLICY };
  const shape = postingPolicySchema.shape;
  for (const key of Object.keys(shape) as (keyof PostingPolicy)[]) {
    const parsed = shape[key].safeParse((value as Record<string, unknown>)[key]);
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

export function templateApproved(policy: PostingPolicy, template: PostTemplate): boolean {
  return policy.templates.includes(template);
}

export type CadenceBlock = "spacing" | "hourly_cap" | "daily_cap" | "quiet_hours";

function inQuietHours(policy: PostingPolicy, now: Date): boolean {
  const q = policy.quietHoursUtc;
  if (!q) return false;
  const h = now.getUTCHours();
  return q.start <= q.end ? h >= q.start && h < q.end : h >= q.start || h < q.end;
}

/**
 * The cadence gate. `recentPosts` are this profile's post times (any
 * status that reached the platform or the review queue); anything older
 * than a day is ignored.
 */
export function canPostNow(
  policy: PostingPolicy,
  recentPosts: readonly Date[],
  now: Date,
): { ok: true } | { ok: false; reason: CadenceBlock } {
  const t = now.getTime();
  const lastDay = recentPosts.map((d) => d.getTime()).filter((x) => x <= t && t - x < DAY);
  const newest = lastDay.length > 0 ? Math.max(...lastDay) : null;
  if (newest !== null && t - newest < policy.minMinutesBetween * 60 * 1000) {
    return { ok: false, reason: "spacing" };
  }
  if (lastDay.filter((x) => t - x < HOUR).length >= policy.maxPostsPerHour) {
    return { ok: false, reason: "hourly_cap" };
  }
  if (lastDay.length >= policy.maxPostsPerDay) return { ok: false, reason: "daily_cap" };
  if (inQuietHours(policy, now)) return { ok: false, reason: "quiet_hours" };
  return { ok: true };
}
