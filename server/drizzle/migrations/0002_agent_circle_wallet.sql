-- Migrate agent wallets from Coinbase CDP to Circle Developer-Controlled
-- Wallets.
--
-- Existing rows point to CDP accounts that no longer apply, so clear
-- them — agent wallets are derived and get re-provisioned on the next request.
-- Then rename the provider-id column and enforce one wallet per user (lets
-- provisioning upsert on user_id and makes the concurrent-provision race a
-- no-op instead of a duplicate row).
DELETE FROM "agent_wallets";
--> statement-breakpoint
ALTER TABLE "agent_wallets" RENAME COLUMN "cdp_wallet_id" TO "circle_wallet_id";
--> statement-breakpoint
ALTER TABLE "agent_wallets" ADD CONSTRAINT "agent_wallets_user_id_unique" UNIQUE ("user_id");
