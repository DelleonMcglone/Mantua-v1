-- B9-005 — bounded execution retries for the strategy engine. A triggered
-- close that fails releases its claim back to `armed` and counts an attempt
-- here; at the bound (MAX_EXECUTE_ATTEMPTS in strategy-store.ts) the engine
-- auto-disarms with reason `execute-failed` instead of retrying forever.
-- Cap-holds deliberately do not count an attempt — the daily spending cap
-- resets at UTC midnight and the close simply retries on a later tick.
ALTER TABLE "hedge_strategies" ADD COLUMN IF NOT EXISTS "execute_attempts" integer DEFAULT 0 NOT NULL;
