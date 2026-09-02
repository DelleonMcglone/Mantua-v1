import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";

export const pools = pgTable("pools", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  /** Chain the pool lives on — Base Mainnet (8453). */
  chainId: integer("chain_id").notNull().default(8453),
  poolKeyHash: varchar("pool_key_hash", { length: 66 }).notNull().unique(),
  token0: varchar("token0", { length: 42 }).notNull(),
  token1: varchar("token1", { length: 42 }).notNull(),
  fee: integer("fee").notNull(),
  tickSpacing: integer("tick_spacing").notNull(),
  hookAddress: varchar("hook_address", { length: 42 }),
  hookType: varchar("hook_type", { length: 32 }),
  createdTx: varchar("created_tx", { length: 66 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const positions = pgTable(
  "positions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    poolId: uuid("pool_id")
      .notNull()
      .references(() => pools.id),
    tokenId: varchar("token_id", { length: 80 }),
    tickLower: integer("tick_lower").notNull(),
    tickUpper: integer("tick_upper").notNull(),
    liquidity: numeric("liquidity", { precision: 78, scale: 0 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    openedTx: varchar("opened_tx", { length: 66 }),
    closedTx: varchar("closed_tx", { length: 66 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("positions_user_idx").on(t.userId, t.status)],
);

export const portfolioTransactions = pgTable(
  "portfolio_transactions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    txHash: varchar("tx_hash", { length: 66 }).notNull().unique(),
    chainId: integer("chain_id").notNull().default(8453),
    params: jsonb("params").notNull(),
    outcome: varchar("outcome", { length: 16 }).notNull(),
    usdValue: numeric("usd_value", { precision: 20, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("portfolio_tx_user_idx").on(t.userId, t.createdAt),
    index("portfolio_tx_wallet_idx").on(t.walletAddress, t.createdAt),
  ],
);

export type Pool = typeof pools.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type PortfolioTransaction = typeof portfolioTransactions.$inferSelect;
