import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  jsonb,
  text,
  integer,
  numeric,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * User-facing activity feed — the "what happened" timeline the portfolio and
 * agent surfaces render. Append-only: rows are written once at the moment an
 * action lands and never updated, which is why references are plain values
 * rather than FKs — a feed entry must outlive the market or position it
 * describes. This is presentation history; `mantua_audit_log` (safety.ts)
 * remains the compliance record.
 */
export const activity = pgTable(
  "activity",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Nullable so system-wide entries (resolutions, freezes) can appear too. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    walletAddress: varchar("wallet_address", { length: 42 }),
    /** `ActivityKind` (lib/activity.ts) — market_buy | market_sell | redeem |
     *  settlement | swap | liquidity_add | liquidity_remove | send | bridge |
     *  deposit | withdraw | gateway_deposit | gateway_spend | hedge |
     *  agent_research | agent_simulation | agent_recommendation | resolution |
     *  combo_open | combo_close | combo_settle (task 072). */
    kind: varchar("kind", { length: 32 }).notNull(),
    /** PF-017 — pending | completed | failed; pending moves exactly once. */
    status: varchar("status", { length: 12 }).notNull().default("completed"),
    /** PF-016 attribution — user | agent | system. */
    actor: varchar("actor", { length: 8 }).notNull().default("user"),
    chainId: integer("chain_id").notNull().default(8453),
    marketId: varchar("market_id", { length: 66 }),
    poolId: varchar("pool_id", { length: 66 }),
    /** Related position / strategy / intent (no FK — entries outlive them). */
    positionRef: varchar("position_ref", { length: 128 }),
    /** Token symbol or outcome label the amount is in. */
    asset: varchar("asset", { length: 32 }),
    amountRaw: varchar("amount_raw", { length: 78 }),
    valueUsd: numeric("value_usd", { precision: 20, scale: 2 }),
    /** One-line human summary, rendered verbatim. */
    summary: text("summary").notNull(),
    /** What the entry is about: a marketId, positionId, intentId… no FK on
     *  purpose (see header). */
    refId: varchar("ref_id", { length: 128 }),
    txHash: varchar("tx_hash", { length: 66 }),
    /** Structured extras for richer cards (amounts, sides, odds). */
    data: jsonb("data")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_user_time_idx").on(t.userId, t.createdAt),
    index("activity_kind_idx").on(t.kind),
    index("activity_ref_idx").on(t.refId),
    index("activity_wallet_time_idx").on(t.walletAddress, t.createdAt),
    // One entry per (tx, kind): a replayed fill report, or a webhook and a
    // poll finalizing the same execution, write one row.
    uniqueIndex("activity_tx_kind_uq").on(t.txHash, t.kind),
  ],
);

export type Activity = typeof activity.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;
