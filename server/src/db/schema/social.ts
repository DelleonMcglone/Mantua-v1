import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  text,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * Task 070 (Phase 13) — the agent's public identity, its posts, and the
 * support tickets a conversation can open.
 *
 * `agent_social_profiles` — one per user: the public handle the
 * performance page is served under, the wallet the ledger is derived for,
 * and the posting policy (templates the user approved, cadence). The
 * platform credentials are NOT here: the deployment holds one X account in
 * server env (D-107) and profiles opt in to post through it.
 *
 * `social_posts` — every post attempt, sent or not: the text as composed,
 * the template and market it came from, and the outcome (posted, dry_run,
 * rejected by the lint, rejected by the user, failed upstream). The public
 * page renders the posted ones; the rest are the operator's record.
 *
 * `support_tickets` — AE-010 escalations: the summary the support agent
 * wrote, the user (nullable for anonymous chats), and the status a human
 * moves.
 */
export const agentSocialProfiles = pgTable(
  "agent_social_profiles",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Lower-case, 3–24 chars of [a-z0-9_]; the public URL segment. */
    handle: varchar("handle", { length: 24 }).notNull(),
    displayName: varchar("display_name", { length: 48 }).notNull(),
    bio: varchar("bio", { length: 280 }).notNull().default(""),
    /** The agent wallet the ledger is derived for (lower-case). */
    walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
    /** Public page reachable; false hides it (404) without deleting anything. */
    isPublic: boolean("is_public").notNull().default(true),
    /** x — the only platform today (D-107). */
    platform: varchar("platform", { length: 16 }).notNull().default("x"),
    /** Posting enabled by the user; the deployment's credentials still gate sending. */
    postingEnabled: boolean("posting_enabled").notNull().default(false),
    /** `PostingPolicy` (lib/social/posting-policy.ts): templates, cadence, quiet hours. */
    postingPolicy: jsonb("posting_policy")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_social_profiles_user_uq").on(t.userId),
    uniqueIndex("agent_social_profiles_handle_uq").on(t.handle),
  ],
);

export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => agentSocialProfiles.id, { onDelete: "cascade" }),
    /** market_update | explain_move | price_signal (lib/social/templates.ts). */
    template: varchar("template", { length: 24 }).notNull(),
    marketId: varchar("market_id", { length: 66 }),
    text: text("text").notNull(),
    /** posted | dry_run | rejected_lint | rejected_user | pending_review | failed */
    status: varchar("status", { length: 16 }).notNull(),
    /** Lint violations, upstream error, or the platform post id. */
    detail: jsonb("detail")
      .notNull()
      .default(sql`'{}'::jsonb`),
    externalId: varchar("external_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("social_posts_profile_time_idx").on(t.profileId, t.createdAt),
    index("social_posts_market_idx").on(t.marketId, t.template),
  ],
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** open | in_progress | resolved — moved by a human, never by the agent. */
    status: varchar("status", { length: 16 }).notNull().default("open"),
    /** billing | trading | agent | account | other */
    category: varchar("category", { length: 16 }).notNull(),
    summary: text("summary").notNull(),
    /** The last turns of the conversation, bounded, for the human. */
    transcript: jsonb("transcript")
      .notNull()
      .default(sql`'[]'::jsonb`),
    channel: varchar("channel", { length: 16 }).notNull().default("web"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_tickets_status_time_idx").on(t.status, t.createdAt)],
);

export type AgentSocialProfile = typeof agentSocialProfiles.$inferSelect;
export type NewAgentSocialProfile = typeof agentSocialProfiles.$inferInsert;
export type SocialPost = typeof socialPosts.$inferSelect;
export type NewSocialPost = typeof socialPosts.$inferInsert;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type NewSupportTicket = typeof supportTickets.$inferInsert;
