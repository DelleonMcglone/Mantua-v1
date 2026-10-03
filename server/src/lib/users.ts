import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/index.ts";

/** The user's row id, creating the row on first sight (race-safe). */
export async function ensureUser(privyUserId: string): Promise<string> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const found = existing.at(0);
  if (found) return found.id;
  const inserted = await db
    .insert(users)
    .values({ privyUserId })
    .onConflictDoNothing({ target: users.privyUserId })
    .returning({ id: users.id });
  const row = inserted.at(0);
  if (row) return row.id;
  // Conflict raced with another insert — re-read.
  const reread = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const rerow = reread.at(0);
  if (!rerow) throw new Error("Failed to ensure user row.");
  return rerow.id;
}
