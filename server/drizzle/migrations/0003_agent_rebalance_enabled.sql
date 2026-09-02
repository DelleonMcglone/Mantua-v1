-- Phase 2: per-agent opt-in to autonomous peg de-peg-exit rebalancing.
ALTER TABLE "agent_wallets" ADD COLUMN "rebalance_enabled" boolean DEFAULT false NOT NULL;
