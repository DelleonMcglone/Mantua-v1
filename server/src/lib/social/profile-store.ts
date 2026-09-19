import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../../db/client.ts";
import { agentSocialProfiles, type AgentSocialProfile } from "../../db/schema/social.ts";
import { policyFromJson, postingPolicyPatchSchema, type PostingPolicy } from "./posting-policy.ts";

/**
 * Task 070 / AE-001, AE-005 — persistence for the agent's public profile:
 * the one row a user writes (handle, name, visibility, posting policy).
 * The post record lives in `post-store.ts`.
 */

export const handleSchema = z
  .string()
  .regex(/^[a-z0-9_]{3,24}$/, "3–24 lower-case letters, digits or underscores");

export const profilePatchSchema = z
  .object({
    handle: handleSchema.optional(),
    displayName: z.string().trim().min(2).max(48).optional(),
    bio: z.string().trim().max(280).optional(),
    isPublic: z.boolean().optional(),
    postingEnabled: z.boolean().optional(),
    postingPolicy: postingPolicyPatchSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export interface ProfileView {
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

export function viewFromRow(row: AgentSocialProfile): ProfileView {
  return {
    handle: row.handle,
    displayName: row.displayName,
    bio: row.bio,
    walletAddress: row.walletAddress,
    isPublic: row.isPublic,
    platform: row.platform,
    postingEnabled: row.postingEnabled,
    postingPolicy: policyFromJson(row.postingPolicy),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function readProfileByUser(
  db: DB,
  userId: string,
): Promise<AgentSocialProfile | null> {
  const rows = await db
    .select()
    .from(agentSocialProfiles)
    .where(eq(agentSocialProfiles.userId, userId))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function readProfileByHandle(
  db: DB,
  handle: string,
): Promise<AgentSocialProfile | null> {
  const rows = await db
    .select()
    .from(agentSocialProfiles)
    .where(eq(agentSocialProfiles.handle, handle.toLowerCase()))
    .limit(1);
  return rows.at(0) ?? null;
}

/** Create or update the user's profile. A first write needs a handle and a name. */
export async function upsertProfile(
  db: DB,
  userId: string,
  walletAddress: string,
  patch: ProfilePatch,
): Promise<AgentSocialProfile> {
  const existing = await readProfileByUser(db, userId);
  const policy = policyFromJson({
    ...(existing ? policyFromJson(existing.postingPolicy) : {}),
    ...(patch.postingPolicy ?? {}),
  });
  const { postingPolicy: _ignored, ...fields } = patch;
  if (!existing) {
    const { handle, displayName } = fields;
    if (!handle || !displayName) {
      throw new Error("A new profile needs a handle and a display name.");
    }
    const [row] = await db
      .insert(agentSocialProfiles)
      .values({
        userId,
        walletAddress: walletAddress.toLowerCase(),
        handle,
        displayName,
        bio: fields.bio ?? "",
        isPublic: fields.isPublic ?? true,
        postingEnabled: fields.postingEnabled ?? false,
        postingPolicy: policy,
      })
      .returning();
    return row;
  }
  const [row] = await db
    .update(agentSocialProfiles)
    .set({ ...fields, postingPolicy: policy, updatedAt: new Date() })
    .where(eq(agentSocialProfiles.id, existing.id))
    .returning();
  return row;
}

export async function listPostingProfiles(db: DB): Promise<AgentSocialProfile[]> {
  return db.select().from(agentSocialProfiles).where(eq(agentSocialProfiles.postingEnabled, true));
}
