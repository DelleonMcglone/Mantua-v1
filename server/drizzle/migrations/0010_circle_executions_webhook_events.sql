-- C-015 — receipt-confirmed execution. `circle_executions` is the durable
-- ledger for every Circle transaction the server creates while awaiting a
-- terminal state: the sync poll and the webhook finalizer race on the same
-- row and exactly one finalizes it (pending → confirmed | failed). Rows are
-- created the moment Circle accepts the transaction, so a timed-out poll
-- still leaves the webhook finalizer something to resolve. `webhook_events`
-- records raw notification deliveries keyed by Circle's notification id —
-- redelivery is a no-op at the storage layer (unique).
CREATE TABLE IF NOT EXISTS "circle_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_tx_id" varchar(64) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"action" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"final_state" varchar(16),
	"finalize_source" varchar(16),
	"finalized_at" timestamp with time zone,
	"notification_id" varchar(64),
	"user_id" uuid,
	"wallet_address" varchar(42),
	"circle_wallet_id" varchar(128),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circle_executions_circle_tx_id_unique" UNIQUE("circle_tx_id")
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'circle_executions_user_id_users_id_fk') THEN
		ALTER TABLE "circle_executions" ADD CONSTRAINT "circle_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "circle_executions_status_idx" ON "circle_executions" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "circle_executions_wallet_idx" ON "circle_executions" USING btree ("wallet_address","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" varchar(64) NOT NULL,
	"event_type" varchar(64),
	"circle_tx_id" varchar(64),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_notification_id_unique" UNIQUE("notification_id")
);
