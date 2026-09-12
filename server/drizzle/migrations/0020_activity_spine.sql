-- Task 062 (Phase 9, PF-014 … PF-017) — the unified Activity system's spine.
-- The `activity` table (0009) had no writers; it gains the columns the
-- timeline needs: a one-way status, the acting party, the market / pool /
-- position the entry relates to, the asset and amount, a USD value, and a
-- (tx_hash, kind) uniqueness rule so replays and double finalization write
-- one row. `kind` widens for the typed vocabulary in lib/activity.ts.
--
-- Idempotent (IF NOT EXISTS) per the 0009 convention.
ALTER TABLE "activity" ALTER COLUMN "kind" TYPE varchar(32);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "status" varchar(12) DEFAULT 'completed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "actor" varchar(8) DEFAULT 'user' NOT NULL;
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "chain_id" integer DEFAULT 8453 NOT NULL;
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "market_id" varchar(66);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "pool_id" varchar(66);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "position_ref" varchar(128);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "asset" varchar(32);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "amount_raw" varchar(78);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "value_usd" numeric(20, 2);
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_wallet_time_idx" ON "activity" USING btree ("wallet_address","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activity_tx_kind_uq" ON "activity" USING btree ("tx_hash","kind");
