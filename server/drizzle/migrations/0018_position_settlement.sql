-- Task 046 (P-006) — market_positions gains writers and a settlement state.
--
-- `settled_at` / `settlement_price` are stamped by the post-resolution
-- settlement pass: 1 for the winning side, 0 for the losing side, 0.5 on
-- INVALID. `redeemed_at` (existing) stays the separate "tokens actually
-- cashed in" marker — settled-but-unclaimed is settled_at set + redeemed_at
-- null, which is what the claimables surface reads.
--
-- The unique makes the fill path's aggregate upsert race-safe: one row per
-- (market, wallet, side). Safe to add — nothing has ever written this table
-- (P-006: zero writers before this task), so no duplicate rows can exist.
--
-- Idempotent (IF NOT EXISTS) per the 0009 convention.
ALTER TABLE "market_positions" ADD COLUMN IF NOT EXISTS "settled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "market_positions" ADD COLUMN IF NOT EXISTS "settlement_price" numeric(6, 5);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_positions_market_wallet_side_uq" ON "market_positions" ("market_id","wallet_address","side");
