import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  numeric,
  timestamp,
  index,
  boolean,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";

export const agentWallets = pgTable(
  "agent_wallets",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Circle blockchain id: "ARC". One wallet row per (user,
     *  blockchain) — the walletId IS the chain selector on Circle's
     *  transaction API. */
    blockchain: varchar("blockchain", { length: 32 }).notNull().default("ARC"),
    // Circle Developer-Controlled Wallets wallet id (chain-specific).
    circleWalletId: varchar("circle_wallet_id", { length: 128 }).notNull().unique(),
    /** Task 074 — the Circle wallet set the wallet was created in. Null for
     *  wallets created before the column (the retail set); an institution's
     *  members carry the institution's set, and the custody gate refuses a
     *  spend from any other. */
    walletSetId: varchar("wallet_set_id", { length: 64 }),
    address: varchar("address", { length: 42 }).notNull(),
    label: varchar("label", { length: 64 }),
    dailyCapUsd: numeric("daily_cap_usd", { precision: 20, scale: 2 }).notNull().default("100"),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    // Opt-in to autonomous peg de-peg-exit rebalancing (Phase 2). Default off.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_wallets_user_idx").on(t.userId),
    unique("agent_wallets_user_chain_uq").on(t.userId, t.blockchain),
    unique("agent_wallets_address_chain_uq").on(t.address, t.blockchain),
  ],
);

export type AgentWallet = typeof agentWallets.$inferSelect;
export type NewAgentWallet = typeof agentWallets.$inferInsert;

/**
 * Per-user agent trading policy — the declarative constraints the agent's
 * market-trading loop must satisfy before it acts, distinct from the wallet
 * spending cap (which bounds dollars, not behavior). Columns the sweeps
 * filter on are real columns; everything strategy-shaped lives in `config`
 * jsonb because it will keep changing. One active policy per user for now
 * (the unique is on user_id, not (user_id, name)) — loosen it if named
 * policy profiles ever ship.
 */
export const agentPolicies = pgTable(
  "agent_policies",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** active | paused */
    status: varchar("status", { length: 8 }).notNull().default("active"),
    /** Master switch for unprompted trades; chat-directed actions ignore it. */
    autoTradeEnabled: boolean("auto_trade_enabled").notNull().default(false),
    /** Hard per-trade ceiling in USD. Checked in addition to the daily cap. */
    maxStakePerTradeUsd: numeric("max_stake_per_trade_usd", { precision: 20, scale: 2 })
      .notNull()
      .default("25"),
    /** conservative | balanced | aggressive — presets the prompt reads. */
    riskLevel: varchar("risk_level", { length: 12 }).notNull().default("conservative"),
    /** League slugs the agent may trade; empty array = all launch leagues. */
    allowedLeagues: jsonb("allowed_leagues")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Everything else: edge thresholds, market-type filters, hedging prefs. */
    config: jsonb("config")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("agent_policies_user_uq").on(t.userId)],
);

export type AgentPolicy = typeof agentPolicies.$inferSelect;
export type NewAgentPolicy = typeof agentPolicies.$inferInsert;
