-- Multi-chain markets: tag each market row with its chain (Base Mainnet,
-- 8453). market_id stays the primary key — ids are chain-distinct by
-- derivation (market-id.ts mixes the chain id into the hash) — but the
-- per-event uniqueness must widen so the same game can carry a market on
-- each chain.
-- IF EXISTS: the markets tables predate this chain (created via drizzle
-- push, never CREATE-migrated). On a fresh database they don't exist yet —
-- 0009 baselines them with chain_id and the widened unique already in
-- place, so this migration is a no-op there.
ALTER TABLE IF EXISTS "markets" ADD COLUMN IF NOT EXISTS "chain_id" integer DEFAULT 8453 NOT NULL;
--> statement-breakpoint
ALTER TABLE IF EXISTS "markets" DROP CONSTRAINT IF EXISTS "markets_event_type_outcome_uq";
--> statement-breakpoint
DO $$ BEGIN
	IF to_regclass('public.markets') IS NOT NULL
		AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'markets_event_type_outcome_chain_uq') THEN
		ALTER TABLE "markets" ADD CONSTRAINT "markets_event_type_outcome_chain_uq" UNIQUE ("event_id", "market_type", "outcome_index", "chain_id");
	END IF;
END $$;
