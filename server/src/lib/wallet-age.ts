import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/users.ts";
import { TIER_RAISE_DAYS, TIER_CAPS_USD } from "./constants.ts";

const MS_PER_DAY = 86_400_000;

export type WalletTier = "early" | "mid" | "full";

export interface WalletAgeInfo {
  firstSeenAt: Date;
  ageDays: number;
  tier: WalletTier;
  tierMaxCapUsd: number;
}

/**
 * P1-002 — record the first time a wallet connects. Idempotent: if a user
 * row already exists for this Privy user id, only `primary_address` is
 * updated (if missing). `first_seen_at` is preserved on subsequent calls.
 */
export async function recordFirstSeen(privyUserId: string, primaryAddress: string): Promise<Date> {
  const lower = primaryAddress.toLowerCase();
  const [row] = await db
    .insert(users)
    .values({ privyUserId, primaryAddress: lower })
    .onConflictDoUpdate({
      target: users.privyUserId,
      set: {
        primaryAddress: sql`coalesce(${users.primaryAddress}, ${lower})`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ firstSeenAt: users.firstSeenAt });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- drizzle types the returning row as defined, but defends against an empty result.
  if (!row) throw new Error("recordFirstSeen: insert returned no row");
  return row.firstSeenAt;
}

/**
 * P1-002 — return age info for a wallet by its primary address. Returns
 * null if the wallet has never been recorded.
 */
export async function getWalletAge(address: string): Promise<WalletAgeInfo | null> {
  const lower = address.toLowerCase();
  const [row] = await db
    .select({ firstSeenAt: users.firstSeenAt })
    .from(users)
    .where(eq(users.primaryAddress, lower))
    .limit(1);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- drizzle types the row as defined, but the array is empty for an unknown wallet.
  if (!row) return null;

  const ageDays = Math.floor((Date.now() - row.firstSeenAt.getTime()) / MS_PER_DAY);
  const tier: WalletTier =
    ageDays <= TIER_RAISE_DAYS.earlyMax
      ? "early"
      : ageDays <= TIER_RAISE_DAYS.midMax
        ? "mid"
        : "full";
  return {
    firstSeenAt: row.firstSeenAt,
    ageDays,
    tier,
    tierMaxCapUsd: TIER_CAPS_USD[tier],
  };
}
