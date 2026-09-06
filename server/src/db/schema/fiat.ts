import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  numeric,
  timestamp,
  jsonb,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * F-006 — durable fiat-rails records (Phase 2 fiat rails, D-101).
 *
 * Three tables replace the process-local Map the sandbox stub used:
 *
 *  - `fiat_bank_links`   — one row per user's linked bank. Stores ONLY
 *                          provider references (Plaid item id, Zero Hash
 *                          participant code / external-account id) and
 *                          display-safe metadata (institution name, last-4
 *                          mask). Raw account/routing numbers and Plaid
 *                          access tokens must NEVER land here — that is the
 *                          D-101 boundary (docs/architecture.md).
 *  - `fiat_transfers`    — the durable ledger for every deposit/withdrawal,
 *                          sandbox and live. Status transitions are one-way
 *                          and enforced in `lib/fiat-transfers.ts`.
 *  - `fiat_webhook_events` — raw provider webhook deliveries keyed by
 *                          (provider, event id); redelivery is a storage-level
 *                          no-op (unique), mirroring Circle's webhook_events.
 */
export const fiatBankLinks = pgTable(
  "fiat_bank_links",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "sandbox" (deterministic local adapter) or "plaid". */
    provider: varchar("provider", { length: 16 }).notNull(),
    /** active | revoked */
    status: varchar("status", { length: 16 }).notNull().default("active"),
    /** Plaid item id — an opaque reference, NOT a credential. */
    plaidItemId: varchar("plaid_item_id", { length: 128 }),
    /** Zero Hash participant code for this user (created at first link). */
    zhParticipantCode: varchar("zh_participant_code", { length: 32 }),
    /** Zero Hash external account id created from the Plaid processor token. */
    zhExternalAccountId: varchar("zh_external_account_id", { length: 64 }),
    /** Display-safe bank metadata (never account/routing numbers). */
    institutionName: varchar("institution_name", { length: 128 }),
    /** Last-4 mask as reported by Plaid — display-safe by definition. */
    accountMask: varchar("account_mask", { length: 8 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fiat_bank_links_participant_idx").on(t.zhParticipantCode)],
);

export const fiatTransfers = pgTable(
  "fiat_transfers",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** deposit | withdraw */
    kind: varchar("kind", { length: 8 }).notNull(),
    amountUsd: numeric("amount_usd", { precision: 20, scale: 2 }).notNull(),
    /** pending | processing | complete | failed | canceled — one-way, see
     *  `FIAT_TRANSFER_PRIOR_STATUSES` in lib/fiat-transfers.ts. */
    status: varchar("status", { length: 12 }).notNull().default("pending"),
    /** sandbox | zerohash */
    provider: varchar("provider", { length: 16 }).notNull(),
    /** Client-generated idempotency key sent with every provider call —
     *  a retried request reuses the key, so the provider dedupes. */
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull().unique(),
    /** Zero Hash payment/transfer id — the join key for webhooks & polls.
     *  Provider references ONLY; never bank account numbers. */
    zhTransferId: varchar("zh_transfer_id", { length: 64 }),
    zhParticipantCode: varchar("zh_participant_code", { length: 32 }),
    /** Raw provider status string at last sync (display-safe). */
    providerStatus: varchar("provider_status", { length: 32 }),
    failureReason: text("failure_reason"),
    /** retry | contact_support */
    recoveryAction: varchar("recovery_action", { length: 16 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("fiat_transfers_user_time_idx").on(t.userId, t.createdAt),
    index("fiat_transfers_status_idx").on(t.status, t.createdAt),
    uniqueIndex("fiat_transfers_zh_transfer_uq").on(t.zhTransferId),
  ],
);

export const fiatWebhookEvents = pgTable(
  "fiat_webhook_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** zerohash | plaid */
    provider: varchar("provider", { length: 16 }).notNull(),
    /** Provider event id — unique per provider, so redelivery inserts nothing. */
    eventId: varchar("event_id", { length: 128 }).notNull(),
    eventType: varchar("event_type", { length: 64 }),
    /** Resolved fiat_transfers.id, when the event matched a transfer. */
    transferId: uuid("transfer_id"),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fiat_webhook_events_provider_event_uq").on(t.provider, t.eventId)],
);

export type FiatBankLink = typeof fiatBankLinks.$inferSelect;
export type NewFiatBankLink = typeof fiatBankLinks.$inferInsert;
export type FiatTransferRow = typeof fiatTransfers.$inferSelect;
export type NewFiatTransferRow = typeof fiatTransfers.$inferInsert;
export type FiatWebhookEvent = typeof fiatWebhookEvents.$inferSelect;
export type NewFiatWebhookEvent = typeof fiatWebhookEvents.$inferInsert;
