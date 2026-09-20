import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  numeric,
  timestamp,
  integer,
  text,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * Task 074 (Phase 18) — the institutional tier. An institution is a
 * segregated Circle wallet set (D-120): `circle_wallet_set_id` names it,
 * members' agent wallets are created in it, and the custody rules key on
 * it. Limits are the institution's own (on top of each wallet's cap).
 */
export const institutions = pgTable("institutions", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  slug: varchar("slug", { length: 48 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  /** pending | active | suspended */
  status: varchar("status", { length: 12 }).notNull().default("pending"),
  /** The qualified custodian holding the principal (recorded, not integrated). */
  custodian: varchar("custodian", { length: 32 }).notNull(),
  custodianLabel: varchar("custodian_label", { length: 120 }),
  /** The dedicated Circle wallet set; null until provisioned. */
  circleWalletSetId: varchar("circle_wallet_set_id", { length: 64 }).unique(),
  dailyCapUsd: numeric("daily_cap_usd", { precision: 20, scale: 2 }).notNull().default("10000"),
  perTradeCapUsd: numeric("per_trade_cap_usd", { precision: 20, scale: 2 })
    .notNull()
    .default("2500"),
  /** Withdrawals at or above this need a second approver; 0 = every one. */
  approvalThresholdUsd: numeric("approval_threshold_usd", { precision: 20, scale: 2 })
    .notNull()
    .default("1000"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One institution per user; the role drives the permission matrix. */
export const institutionMembers = pgTable(
  "institution_members",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institutions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** owner | admin | trader | approver | viewer */
    role: varchar("role", { length: 12 }).notNull(),
    /** active | removed */
    status: varchar("status", { length: 12 }).notNull().default("active"),
    addedBy: uuid("added_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("institution_members_user_uq").on(t.userId),
    index("institution_members_inst_idx").on(t.institutionId),
  ],
);

/** The withdrawal allowlist: the custodian's deposit addresses, verified by a second person. */
export const custodyDestinations = pgTable(
  "custody_destinations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institutions.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 80 }).notNull(),
    address: varchar("address", { length: 42 }).notNull(),
    chainId: integer("chain_id").notNull().default(8453),
    /** pending | verified | revoked */
    status: varchar("status", { length: 12 }).notNull().default("pending"),
    addedBy: uuid("added_by").notNull(),
    verifiedBy: uuid("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("custody_destinations_addr_uq").on(t.institutionId, t.address, t.chainId)],
);

/** A withdrawal from an institutional wallet: requested, approved by another, executed. */
export const custodyWithdrawals = pgTable(
  "custody_withdrawals",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institutions.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").notNull(),
    walletAddress: varchar("wallet_address", { length: 42 }).notNull(),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => custodyDestinations.id),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    /** Human units, decimal string. */
    amount: varchar("amount", { length: 78 }).notNull(),
    usdValue: numeric("usd_value", { precision: 20, scale: 2 }).notNull(),
    /** pending | approved | executing | executed | failed | rejected | expired | cancelled */
    status: varchar("status", { length: 12 }).notNull().default("pending"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    reason: text("reason"),
    txHash: varchar("tx_hash", { length: 66 }),
    lastError: text("last_error"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("custody_withdrawals_inst_idx").on(t.institutionId, t.status, t.createdAt)],
);

export type Institution = typeof institutions.$inferSelect;
export type InstitutionMember = typeof institutionMembers.$inferSelect;
export type CustodyDestination = typeof custodyDestinations.$inferSelect;
export type CustodyWithdrawal = typeof custodyWithdrawals.$inferSelect;
