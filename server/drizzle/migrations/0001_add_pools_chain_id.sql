-- PR #101: runtime multi-chain. Pools table gains a chainId column so
-- entries can be filtered per-chain on the Positions tab.
--
-- Rows default to Base Mainnet (8453) — the only supported chain.
ALTER TABLE "pools" ADD COLUMN "chain_id" integer NOT NULL DEFAULT 8453;
