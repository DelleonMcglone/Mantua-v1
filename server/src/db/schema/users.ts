import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    privyUserId: varchar("privy_user_id", { length: 128 }).notNull().unique(),
    primaryAddress: varchar("primary_address", { length: 42 }),
    email: varchar("email", { length: 320 }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_primary_address_idx").on(t.primaryAddress)],
);

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  defaultSlippageBps: varchar("default_slippage_bps", { length: 8 }).notNull().default("50"),
  hideSmallBalances: jsonb("hide_small_balances")
    .notNull()
    .default(sql`'true'::jsonb`),
  dailyCapUsd: varchar("daily_cap_usd", { length: 16 }).notNull().default("500"),
  notificationPrefs: jsonb("notification_prefs")
    .notNull()
    .default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserPreference = typeof userPreferences.$inferSelect;
