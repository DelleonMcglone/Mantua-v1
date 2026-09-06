-- F-006 — durable fiat-rails records (Phase 2 fiat rails, D-101).
--
-- `fiat_bank_links` stores ONLY provider references (Plaid item id,
-- Zero Hash participant code / external-account id) and display-safe
-- metadata. Raw account/routing numbers and Plaid access tokens never
-- reach this database — that is the D-101 integration boundary.
--
-- `fiat_transfers` is the durable deposit/withdrawal ledger for BOTH the
-- sandbox and the live adapter; status transitions are one-way and
-- enforced in server/src/lib/fiat-transfers.ts.
--
-- `fiat_webhook_events` records raw provider webhook deliveries keyed by
-- (provider, event id) — redelivery is a storage-level no-op.
--
-- Idempotent (IF NOT EXISTS) per the 0009 convention, so databases that
-- already carry these tables skip them wholesale.
CREATE TABLE IF NOT EXISTS "fiat_bank_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL UNIQUE REFERENCES "public"."users"("id") ON DELETE cascade,
	"provider" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"plaid_item_id" varchar(128),
	"zh_participant_code" varchar(32),
	"zh_external_account_id" varchar(64),
	"institution_name" varchar(128),
	"account_mask" varchar(8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fiat_bank_links_participant_idx" ON "fiat_bank_links" USING btree ("zh_participant_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiat_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"kind" varchar(8) NOT NULL,
	"amount_usd" numeric(20, 2) NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"provider" varchar(16) NOT NULL,
	"idempotency_key" varchar(64) NOT NULL UNIQUE,
	"zh_transfer_id" varchar(64),
	"zh_participant_code" varchar(32),
	"provider_status" varchar(32),
	"failure_reason" text,
	"recovery_action" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fiat_transfers_user_time_idx" ON "fiat_transfers" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fiat_transfers_status_idx" ON "fiat_transfers" USING btree ("status","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fiat_transfers_zh_transfer_uq" ON "fiat_transfers" USING btree ("zh_transfer_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiat_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(16) NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"event_type" varchar(64),
	"transfer_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fiat_webhook_events_provider_event_uq" ON "fiat_webhook_events" USING btree ("provider","event_id");
