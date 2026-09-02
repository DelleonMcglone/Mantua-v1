-- Multi-chain agent wallets: one Circle wallet row per (user, blockchain).
-- Rows default to Base ("BASE") and are provisioned on first use. The
-- plain user_id/address uniques become per-chain — the same Circle SCA
-- address may or may not repeat across chains.
ALTER TABLE "agent_wallets" ADD COLUMN "blockchain" varchar(32) DEFAULT 'BASE' NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_wallets" DROP CONSTRAINT IF EXISTS "agent_wallets_user_id_unique";
--> statement-breakpoint
ALTER TABLE "agent_wallets" DROP CONSTRAINT IF EXISTS "agent_wallets_address_unique";
--> statement-breakpoint
ALTER TABLE "agent_wallets" ADD CONSTRAINT "agent_wallets_user_chain_uq" UNIQUE ("user_id", "blockchain");
--> statement-breakpoint
ALTER TABLE "agent_wallets" ADD CONSTRAINT "agent_wallets_address_chain_uq" UNIQUE ("address", "blockchain");
