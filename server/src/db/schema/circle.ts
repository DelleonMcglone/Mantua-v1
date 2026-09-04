import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users.ts";

/**
 * C-015 — receipt-confirmed execution.
 *
 * `circle_executions` is the durable ledger for every Circle transaction the
 * server creates while awaiting a terminal state. The sync path (poll) and
 * the durable path (webhook finalizer) race on the SAME row, and exactly one
 * of them may finalize it:
 *
 *   pending → confirmed | failed   (single conditional UPDATE, see
 *                                   `claimExecutionFinalization`)
 *
 * The row exists from the moment Circle accepts the transaction create, so a
 * timed-out poll (serverless freeze, network partition) still leaves the
 * webhook finalizer something to resolve — an execution is never lost just
 * because the lambda that created it died.
 *
 * `webhook_events` records raw notification deliveries keyed by Circle's
 * notification id — redelivery is a no-op at the storage layer (unique),
 * independent of execution state.
 */
export const circleExecutions = pgTable(
  "circle_executions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Circle transaction id — the join key from notifications and polls. */
    circleTxId: varchar("circle_tx_id", { length: 64 }).notNull().unique(),
    /** Execution shape — drives finalization effects. */
    kind: varchar("kind", { length: 32 }).notNull(),
    /** Audit action for the final `mantua_audit_log` row (e.g. "agent_send"). */
    action: varchar("action", { length: 64 }).notNull(),
    /** pending | confirmed | failed */
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    /** Circle terminal state at finalization ("CONFIRMED"/"COMPLETE"/…). */
    finalState: varchar("final_state", { length: 16 }),
    /** poll | webhook — which path won the finalization claim. */
    finalizeSource: varchar("finalize_source", { length: 16 }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    /** Notification id of the webhook that claimed finalization, if any. */
    notificationId: varchar("notification_id", { length: 64 }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    walletAddress: varchar("wallet_address", { length: 42 }),
    circleWalletId: varchar("circle_wallet_id", { length: 128 }),
    /** Kind-specific execution parameters (amounts, strategy id, audit ctx…). */
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("circle_executions_status_idx").on(t.status, t.createdAt),
    index("circle_executions_wallet_idx").on(t.walletAddress, t.createdAt),
  ],
);

export type CircleExecution = typeof circleExecutions.$inferSelect;
export type NewCircleExecution = typeof circleExecutions.$inferInsert;

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  /** Circle notification id — unique, so redelivery inserts nothing. */
  notificationId: varchar("notification_id", { length: 64 }).notNull().unique(),
  eventType: varchar("event_type", { length: 64 }),
  circleTxId: varchar("circle_tx_id", { length: 64 }),
  payload: jsonb("payload")
    .notNull()
    .default(sql`'{}'::jsonb`),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
