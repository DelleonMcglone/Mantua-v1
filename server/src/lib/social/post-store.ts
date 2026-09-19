import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { socialPosts, type NewSocialPost, type SocialPost } from "../../db/schema/social.ts";

/**
 * Task 070 / AE-006 — persistence for the post record. Posts are written
 * by the scheduler and the approval route, have their status moved by the
 * user's decision, and are never deleted: the public page is a record, not
 * a feed to curate.
 */

export async function recordPost(db: DB, row: NewSocialPost): Promise<SocialPost> {
  const [inserted] = await db.insert(socialPosts).values(row).returning();
  return inserted;
}

export async function listPosts(
  db: DB,
  profileId: string,
  opts: { statuses?: readonly string[]; limit?: number; since?: Date } = {},
): Promise<SocialPost[]> {
  const where = [eq(socialPosts.profileId, profileId)];
  if (opts.statuses) where.push(inArray(socialPosts.status, [...opts.statuses]));
  if (opts.since) where.push(gte(socialPosts.createdAt, opts.since));
  return db
    .select()
    .from(socialPosts)
    .where(and(...where))
    .orderBy(desc(socialPosts.createdAt))
    .limit(opts.limit ?? 50);
}

export async function readPost(
  db: DB,
  profileId: string,
  postId: string,
): Promise<SocialPost | null> {
  const rows = await db
    .select()
    .from(socialPosts)
    .where(and(eq(socialPosts.id, postId), eq(socialPosts.profileId, profileId)))
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * Move a pending post to `sending` if, and only if, it is still pending —
 * the one atomic step that makes two concurrent decisions on the same post
 * resolve to one send. Returns false when someone else got there first.
 */
export async function claimPendingPost(
  db: DB,
  postId: string,
  profileId: string,
): Promise<boolean> {
  const rows = await db
    .update(socialPosts)
    .set({ status: "sending" })
    .where(
      and(
        eq(socialPosts.id, postId),
        eq(socialPosts.profileId, profileId),
        eq(socialPosts.status, "pending_review"),
      ),
    )
    .returning({ id: socialPosts.id });
  return rows.length > 0;
}

export async function setPostStatus(
  db: DB,
  postId: string,
  status: string,
  detail: Record<string, unknown>,
  externalId: string | null = null,
): Promise<void> {
  await db
    .update(socialPosts)
    .set({ status, detail, externalId })
    .where(eq(socialPosts.id, postId));
}
