-- Task 040 (S-024/S-026) — resolution-confidence state machine + evidence.
--
-- `resolution_reviews` persists the per-game confidence state
-- (PENDING_RECONCILIATION | VERIFIED | DISPUTED | MANUAL_REVIEW | RESOLVED)
-- whose transitions are defined in ONE tested place,
-- server/src/lib/sports/resolution-confidence.ts. One row per
-- (provider event, chain); `history` is the append-only transition trail.
--
-- `resolutions.confidence_state` stamps each settlement row with the state
-- that authorised it; the full S-026 evidence bundle rides the existing
-- `source_payload` jsonb column (schema "resolution-evidence@1").
--
-- Idempotent (IF NOT EXISTS) per the 0009 convention, so databases that
-- already carry these objects skip them wholesale.
CREATE TABLE IF NOT EXISTS "resolution_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_id" varchar(128) NOT NULL,
	"chain_id" integer DEFAULT 8453 NOT NULL,
	"state" varchar(24) NOT NULL,
	"policy" varchar(16) NOT NULL,
	"reason" text,
	"winning_outcome_index" smallint,
	"first_final_seen_at" timestamp with time zone,
	"disputed_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resolution_reviews_event_chain_uq" UNIQUE("provider_event_id","chain_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resolution_reviews_state_idx" ON "resolution_reviews" USING btree ("state");
--> statement-breakpoint
ALTER TABLE "resolutions" ADD COLUMN IF NOT EXISTS "confidence_state" varchar(24);
