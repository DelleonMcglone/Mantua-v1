-- Task 072 (Phase 16, CB-005 … CB-008) — combo tickets. The `combos` and
-- `combo_legs` tables were created ahead of the feature in 0009 with no
-- writer; this adds what a ticket needs once a combo is a conjunction
-- market (D-119): the market it holds YES in, the shares and the buying
-- transaction, close/settlement/redeem stamps, the source and mode, and
-- the per-leg display fields frozen at placement.
--
-- Idempotent (IF NOT EXISTS) per the 0009 convention. Nothing has ever
-- written these tables, so the unique index on tx_hash cannot collide.
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "market_id" varchar(66);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "chain_id" integer DEFAULT 8453 NOT NULL;
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "market_address" varchar(42);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "yes_token" varchar(42);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "pool_id" varchar(66);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "label" varchar(200);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "starts_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "opening_probability" numeric(6, 5);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "shares_raw" numeric(78, 0);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "entry_price_bps" integer;
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "tx_hash" varchar(66);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "close_tx_hash" varchar(66);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "proceeds_raw" numeric(78, 0);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "settlement_price" numeric(6, 5);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "redeemed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "redeem_tx_hash" varchar(66);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "source" varchar(8) DEFAULT 'user' NOT NULL;
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "mode" varchar(16);
--> statement-breakpoint
ALTER TABLE "combos" ADD COLUMN IF NOT EXISTS "dead_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "combos_market_idx" ON "combos" USING btree ("market_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "combos_tx_hash_uq" ON "combos" USING btree ("tx_hash");
--> statement-breakpoint
ALTER TABLE "combo_legs" ADD COLUMN IF NOT EXISTS "provider_event_id" varchar(128);
--> statement-breakpoint
ALTER TABLE "combo_legs" ADD COLUMN IF NOT EXISTS "outcome_index" smallint;
--> statement-breakpoint
ALTER TABLE "combo_legs" ADD COLUMN IF NOT EXISTS "label" varchar(120);
--> statement-breakpoint
ALTER TABLE "combo_legs" ADD COLUMN IF NOT EXISTS "opponent" varchar(96);
--> statement-breakpoint
ALTER TABLE "combo_legs" ADD COLUMN IF NOT EXISTS "league" varchar(32);
--> statement-breakpoint
ALTER TABLE "combo_legs" ADD COLUMN IF NOT EXISTS "kickoff_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "combo_legs" ADD COLUMN IF NOT EXISTS "result_at" timestamp with time zone;
