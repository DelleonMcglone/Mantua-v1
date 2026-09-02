-- Per-intent retry backoff for the high-frequency intent sweep: the sweep
-- only considers pending intents whose next_check_at is null or due, and
-- pushes it out exponentially on each skip (cleared on any fill). The
-- 'executing' claim status needs no DDL (status is a varchar).
ALTER TABLE "agent_intents" ADD COLUMN "next_check_at" timestamp with time zone;
