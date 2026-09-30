-- 0026 — Arc Mainnet cutover (B-005): the chain_id column defaults move from
-- Base (8453) to Arc (5042). Existing rows are untouched — every writer sets
-- chain_id explicitly; the default only guards inserts that omit it.
ALTER TABLE "pools" ALTER COLUMN "chain_id" SET DEFAULT 5042;--> statement-breakpoint
ALTER TABLE "portfolio_transactions" ALTER COLUMN "chain_id" SET DEFAULT 5042;--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "chain_id" SET DEFAULT 5042;--> statement-breakpoint
ALTER TABLE "combos" ALTER COLUMN "chain_id" SET DEFAULT 5042;--> statement-breakpoint
ALTER TABLE "resolution_reviews" ALTER COLUMN "chain_id" SET DEFAULT 5042;--> statement-breakpoint
ALTER TABLE "activity" ALTER COLUMN "chain_id" SET DEFAULT 5042;--> statement-breakpoint
ALTER TABLE "mantua_audit_log" ALTER COLUMN "chain_id" SET DEFAULT 5042;--> statement-breakpoint
ALTER TABLE "custody_destinations" ALTER COLUMN "chain_id" SET DEFAULT 5042;--> statement-breakpoint
