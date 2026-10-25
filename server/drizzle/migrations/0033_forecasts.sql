-- Forecast ledger (owner, 2026-10-24): every probability the agent forms,
-- append-only at the database, plus one outcome row per market.
--
-- Idempotent (IF NOT EXISTS / DROP TRIGGER IF EXISTS) per the 0009
-- convention.

CREATE TABLE IF NOT EXISTS "forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"session_id" varchar(64),
	"market_id" varchar(66),
	"provider_event_id" varchar(64) NOT NULL,
	"league" varchar(16),
	"event_starts_at" timestamp with time zone NOT NULL,
	"outcome_index" smallint NOT NULL,
	"outcome_label" varchar(120) NOT NULL,
	"agent_probability_bps" integer NOT NULL,
	"confidence" varchar(8),
	"reference_book_bps" integer,
	"reference_pool_bps" integer,
	"liquidity_usdc" numeric(18, 6),
	"source" varchar(16) NOT NULL,
	"action" varchar(20) NOT NULL,
	"trade_id" varchar(66),
	"model_version" varchar(64) NOT NULL,
	"inputs_snapshot" jsonb NOT NULL,
	"after_kickoff" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecasts_market_time_idx" ON "forecasts" USING btree ("market_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecasts_event_idx" ON "forecasts" USING btree ("provider_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecasts_user_idx" ON "forecasts" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forecasts_created_idx" ON "forecasts" USING btree ("created_at");
--> statement-breakpoint

-- ── forecasts is append-only at the database ─────────────────────────────
-- A probability is never edited after the fact; a new view is a new row.
-- Same mechanism as market_fills (0022, AE-014).
CREATE OR REPLACE FUNCTION mantua_refuse_forecast_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'forecasts is append-only (forecast ledger): % refused', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS forecasts_immutable ON "forecasts";
--> statement-breakpoint
CREATE TRIGGER forecasts_immutable
  BEFORE UPDATE OR DELETE ON "forecasts"
  FOR EACH ROW EXECUTE FUNCTION mantua_refuse_forecast_mutation();
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "forecast_outcomes" (
	"market_id" varchar(66) PRIMARY KEY NOT NULL,
	"provider_event_id" varchar(64) NOT NULL,
	"event_starts_at" timestamp with time zone NOT NULL,
	"closing_book_bps" integer,
	"closing_pool_bps" integer,
	"closing_captured_at" timestamp with time zone,
	"winning_outcome_index" smallint,
	"voided" boolean DEFAULT false NOT NULL,
	"settled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
