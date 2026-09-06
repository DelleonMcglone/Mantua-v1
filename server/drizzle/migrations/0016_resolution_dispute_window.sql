-- 044 (D-104) — dispute window + operator hold.
--
-- A mandatory delay (`RESOLUTION_DISPUTE_WINDOW_SECONDS`, default 900)
-- separates the moment an outcome passes the S-025 criteria gate from the
-- on-chain resolve submission. The window lives on the game's pending row
-- (`resolution_reviews` — both markets of a pair share one game outcome):
-- the first sweep that clears the gate stamps opens/closes; later sweeps
-- submit only once `dispute_window_closes_at` has passed, the review is
-- still VERIFIED, and no operator hold is set. A DISPUTED escalation nulls
-- the window so a later re-verification opens a fresh one.
--
-- `operator_hold_*` is the D-104 operator park: written only by the
-- authenticated ops route (POST /api/ops/resolution/hold), always with a
-- note; while set, an elapsed window does not submit.
--
-- `resolutions.dispute_window_*` stamps the window the resolve actually
-- waited out onto the settlement row itself, per D-104 ("the window's
-- open/close timestamps are recorded on the resolutions row"). Null for
-- voids (window-exempt, B4-005), manual overrides, and pre-044 rows.
--
-- Idempotent (IF NOT EXISTS) per the 0009/0014 convention; both tables are
-- guaranteed to exist by 0009/0014 earlier in the chain.
ALTER TABLE "resolution_reviews" ADD COLUMN IF NOT EXISTS "dispute_window_opens_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "resolution_reviews" ADD COLUMN IF NOT EXISTS "dispute_window_closes_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "resolution_reviews" ADD COLUMN IF NOT EXISTS "operator_hold_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "resolution_reviews" ADD COLUMN IF NOT EXISTS "operator_hold_note" text;
--> statement-breakpoint
ALTER TABLE "resolutions" ADD COLUMN IF NOT EXISTS "dispute_window_opens_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "resolutions" ADD COLUMN IF NOT EXISTS "dispute_window_closes_at" timestamp with time zone;
