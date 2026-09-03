import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, timestamp, index, jsonb, text } from "drizzle-orm/pg-core";
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
    /** trade | redeem | liquidity | bridge | send | agent_action | resolution
     *  | strategy | deposit — the feed's filter key. */
    kind: varchar("kind", { length: 24 }).notNull(),
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
  },
  (t) => [
    index("activity_user_time_idx").on(t.userId, t.createdAt),
    index("activity_kind_idx").on(t.kind),
    index("activity_ref_idx").on(t.refId),
  ],
);

export type Activity = typeof activity.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;
