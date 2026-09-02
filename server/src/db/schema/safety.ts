import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  numeric,
  timestamp,
  jsonb,
  text,
  date,
  index,
  uniqueIndex,
  integer,
} from "drizzle-orm/pg-core";

/**
 * Per-wallet daily spend ledger. One row per (wallet, UTC day).
 * Reset boundary is 00:00 UTC. Used by `enforceSpendingCap` (P1-001).
 */
export const dailyWalletSpend = pgTable(
  "daily_wallet_spend",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
    spendDate: date("spend_date").notNull(),
    spentUsd: numeric("spent_usd", { precision: 20, scale: 2 }).notNull().default("0"),
    txCount: integer("tx_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("daily_spend_wallet_date_idx").on(t.walletAddress, t.spendDate)],
);

/**
 * Audit log for every mainnet write attempt, regardless of outcome.
 * Distinct from `portfolio_transactions` (which only records on-chain
 * confirmations). P1-008 — every swap/LP/agent action is logged here.
 */
export const mantuaAuditLog = pgTable(
  "mantua_audit_log",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    walletAddress: varchar("wallet_address", { length: 42 }),
    action: varchar("action", { length: 32 }).notNull(),
    outcome: varchar("outcome", { length: 16 }).notNull(),
    params: jsonb("params")
      .notNull()
      .default(sql`'{}'::jsonb`),
    txHash: varchar("tx_hash", { length: 66 }),
    chainId: integer("chain_id").notNull().default(8453),
    reason: text("reason"),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_wallet_idx").on(t.walletAddress, t.createdAt),
    index("audit_action_idx").on(t.action, t.createdAt),
    index("audit_outcome_idx").on(t.outcome, t.createdAt),
  ],
);

export type DailyWalletSpend = typeof dailyWalletSpend.$inferSelect;
export type NewDailyWalletSpend = typeof dailyWalletSpend.$inferInsert;
export type MantuaAuditLog = typeof mantuaAuditLog.$inferSelect;
export type NewMantuaAuditLog = typeof mantuaAuditLog.$inferInsert;

/**
 * Discriminated union of audit outcomes. Used by the audit logger.
 */
export type AuditOutcome =
  | "pending"
  | "success"
  | "failure"
  | "rejected_cap"
  | "rejected_slippage"
  | "rejected_kill_switch"
  | "rejected_chain"
  | "rejected_other";

/**
 * Discriminated union of audit actions. Extend as new write paths land.
 */
export type AuditAction =
  | "swap"
  | "add_liquidity"
  | "remove_liquidity"
  | "create_pool"
  | "send_tokens"
  | "agent_wallet_create"
  | "agent_wallet_fund"
  | "agent_wallet_provision"
  | "agent_wallet_cap_update"
  | "agent_swap"
  | "agent_intent"
  | "agent_commerce"
  | "agent_send"
  | "agent_add_liquidity"
  | "agent_remove_liquidity"
  | "agent_instruction_parse"
  | "agent_bridge"
  | "agent_x402"
  | "command_parse"
  | "fee_admin_update";
