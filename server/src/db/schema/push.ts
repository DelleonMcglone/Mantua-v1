/**
 * Task 071 (Phase 15, MX-004) — Web Push subscriptions and the delivery
 * log. One row per browser subscription (a user may hold several — a phone
 * and a laptop); `topics` is the user's per-category opt-in. The delivery
 * log is the idempotency key: one (user, tag) is sent once, so a replayed
 * fill report or a re-run cron tick can never notify twice.
 */
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users.ts";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The push service URL the browser handed us; unique per browser. */
    endpoint: text("endpoint").notNull().unique(),
    /** The subscription's P-256 public key and auth secret, base64url. */
    p256dh: varchar("p256dh", { length: 128 }).notNull(),
    auth: varchar("auth", { length: 64 }).notNull(),
    /** Per-topic opt-in, e.g. {"trades":true,"games":false}; absent = on. */
    topics: jsonb("topics")
      .notNull()
      .default(sql`'{}'::jsonb`),
    userAgent: varchar("user_agent", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

export const pushDeliveries = pgTable(
  "push_deliveries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The message tag (see lib/push/notifications.ts) — the dedupe key. */
    tag: varchar("tag", { length: 160 }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("push_deliveries_user_tag_uq").on(t.userId, t.tag),
    index("push_deliveries_sent_idx").on(t.sentAt),
  ],
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
