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
    chainId: integer("chain_id").notNull().default(5042),
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

export type PortfolioTransaction = typeof portfolioTransactions.$inferSelect;
