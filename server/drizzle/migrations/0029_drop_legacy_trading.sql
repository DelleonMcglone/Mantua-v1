-- 0029 — legacy removal (owner 2026-10-03, D-123): the stablecoin-era tables
-- leave the schema. Production counts before this ran: pools 9 (Base-era
-- base-pair pools, never read since the Arc cutover), positions 0,
-- agent_intents 0, fiat_bank_links 0, fiat_transfers 0, fiat_webhook_events 0.
-- market_positions (the prediction-market ledger) is untouched.
DROP TABLE IF EXISTS "fiat_webhook_events";--> statement-breakpoint
DROP TABLE IF EXISTS "fiat_transfers";--> statement-breakpoint
DROP TABLE IF EXISTS "fiat_bank_links";--> statement-breakpoint
DROP TABLE IF EXISTS "agent_intents";--> statement-breakpoint
DROP TABLE IF EXISTS "positions";--> statement-breakpoint
DROP TABLE IF EXISTS "pools";--> statement-breakpoint
-- The auto-rebalance opt-in rode with the peg-sync loop.
ALTER TABLE "agent_wallets" DROP COLUMN IF EXISTS "rebalance_enabled";--> statement-breakpoint
-- The column default was 'BASE' from 0007; every writer sets it explicitly,
-- but the default should name the chain the app runs on.
ALTER TABLE "agent_wallets" ALTER COLUMN "blockchain" SET DEFAULT 'ARC';
