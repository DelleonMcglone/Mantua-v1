-- Task 049 (H-011) — market_fills records the D-105 fee each verified trade
-- paid, decoded from the Dynamic Market Hook's MarketFeeUpdated log in the
-- receipt: the pip fee charged on the input, the dynamic rate, the pool
-- probability the fee was shaped by, the fee valued in USDC (6dp raw), and
-- the season flag. All nullable — fills recorded before the hook deployment
-- carry no event and stay as they are.
--
-- Idempotent (IF NOT EXISTS) per the 0009 convention.
ALTER TABLE "market_fills" ADD COLUMN IF NOT EXISTS "fee_pips" integer;
--> statement-breakpoint
ALTER TABLE "market_fills" ADD COLUMN IF NOT EXISTS "fee_rate_pips" integer;
--> statement-breakpoint
ALTER TABLE "market_fills" ADD COLUMN IF NOT EXISTS "fee_probability_bps" integer;
--> statement-breakpoint
ALTER TABLE "market_fills" ADD COLUMN IF NOT EXISTS "fee_usdc_raw" varchar(32);
--> statement-breakpoint
ALTER TABLE "market_fills" ADD COLUMN IF NOT EXISTS "playoffs" boolean;
