/**
 * The pre-launch waitlist (owner, 2026-10-04): one row per email, lower-
 * cased and unique so a second submit is a no-op rather than a duplicate.
 * `source` names the page that collected it; `userAgent` is kept bounded
 * for a rough device split, nothing more.
 */
import { sql } from "drizzle-orm";
import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const waitlist = pgTable("waitlist", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 254 }).notNull().unique(),
  source: varchar("source", { length: 32 }).notNull().default("landing"),
  userAgent: varchar("user_agent", { length: 200 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WaitlistRow = typeof waitlist.$inferSelect;
