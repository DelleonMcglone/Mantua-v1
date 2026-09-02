-- Multi-chain markets: tag each market row with its chain (Base Mainnet,
-- 8453). market_id stays the primary key — ids are chain-distinct by
-- derivation (market-id.ts mixes the chain id into the hash) — but the
-- per-event uniqueness must widen so the same game can carry a market on
-- each chain.
ALTER TABLE "markets" ADD COLUMN "chain_id" integer DEFAULT 8453 NOT NULL;
--> statement-breakpoint
ALTER TABLE "markets" DROP CONSTRAINT IF EXISTS "markets_event_type_outcome_uq";
--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_event_type_outcome_chain_uq" UNIQUE ("event_id", "market_type", "outcome_index", "chain_id");
