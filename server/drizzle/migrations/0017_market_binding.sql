-- Task 046 (P-002) — persist the marketId keccak preimage binding at creation.
--
-- `market_id` is keccak256(abi.encode(providerEventId, marketType,
-- outcomeIndex[, chainId])) per docs/specs/market-id.md. marketType,
-- outcomeIndex, and chainId already live on the row; the two hash inputs
-- that did NOT were only reachable through the mutable `events` FK. These
-- columns freeze them on the market row at creation, so the binding is
-- independently recomputable (the creation sweep verifies preimage →
-- marketId before persisting) and survives provider changes on the event.
--
-- Nullable by design: rows minted before this task carry null until the
-- next sync tick's upsert backfills them (write-once via coalesce).
--
-- Idempotent (IF NOT EXISTS) per the 0009 convention.
ALTER TABLE "markets" ADD COLUMN IF NOT EXISTS "provider" varchar(32);
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN IF NOT EXISTS "provider_event_id" varchar(128);
