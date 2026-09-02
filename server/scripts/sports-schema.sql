-- Sports/markets schema (B1), extracted from the drizzle diff and made
-- idempotent, because the drizzle meta snapshots have drifted from the
-- applied migrations (0002/0003 exist as files but not in the snapshot) --
-- a full generated migration re-creates tables prod already has. Safe to
-- run repeatedly. Migration-state cleanup is tracked separately.
CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_event_id" varchar(128) NOT NULL,
	"home_team" varchar(96) NOT NULL,
	"away_team" varchar(96) NOT NULL,
	"home_team_key" varchar(64),
	"away_team_key" varchar(64),
	"starts_at" timestamp with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'scheduled' NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"last_polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_provider_event_uq" UNIQUE("provider","provider_event_id")
);;
CREATE TABLE IF NOT EXISTS "hedge_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_id" varchar(66),
	"strategy_type" varchar(24) NOT NULL,
	"status" varchar(16) DEFAULT 'armed' NOT NULL,
	"config" jsonb NOT NULL,
	"cap_usd" numeric(20, 2) NOT NULL,
	"expires_at" timestamp with time zone,
	"armed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triggered_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"disarmed_reason" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
CREATE TABLE IF NOT EXISTS "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport_id" uuid NOT NULL,
	"slug" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"coverage" varchar(8) DEFAULT 'soon' NOT NULL,
	"provider_key" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_slug_unique" UNIQUE("slug")
);;
CREATE TABLE IF NOT EXISTS "market_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar(66) NOT NULL,
	"outcome_index" smallint NOT NULL,
	"label" varchar(96) NOT NULL,
	"is_winner" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_outcomes_market_index_uq" UNIQUE("market_id","outcome_index")
);;
CREATE TABLE IF NOT EXISTS "market_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_id" varchar(66) NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"side" varchar(3) NOT NULL,
	"size" numeric(78, 0) NOT NULL,
	"entry_price" numeric(6, 5),
	"redeemed_at" timestamp with time zone,
	"redeem_tx_hash" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);;
CREATE TABLE IF NOT EXISTS "markets" (
	"market_id" varchar(66) PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"market_type" varchar(16) DEFAULT 'moneyline' NOT NULL,
	"outcome_index" smallint NOT NULL,
	"state" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"yes_token" varchar(42),
	"no_token" varchar(42),
	"pool_id" varchar(66),
	"opening_probability" numeric(6, 5),
	"frozen_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_event_type_outcome_uq" UNIQUE("event_id","market_type","outcome_index")
);;
CREATE TABLE IF NOT EXISTS "resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar(66) NOT NULL,
	"winning_outcome_index" smallint,
	"method" varchar(8) NOT NULL,
	"source" varchar(64),
	"source_payload" jsonb,
	"signer" varchar(42),
	"tx_hash" varchar(66),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);;
CREATE TABLE IF NOT EXISTS "sports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sports_slug_unique" UNIQUE("slug")
);;
DO $$ BEGIN
ALTER TABLE "events" ADD CONSTRAINT "events_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE "hedge_strategies" ADD CONSTRAINT "hedge_strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE "hedge_strategies" ADD CONSTRAINT "hedge_strategies_market_id_markets_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("market_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE "market_outcomes" ADD CONSTRAINT "market_outcomes_market_id_markets_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("market_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE "market_positions" ADD CONSTRAINT "market_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE "market_positions" ADD CONSTRAINT "market_positions_market_id_markets_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("market_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE "markets" ADD CONSTRAINT "markets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_market_id_markets_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("market_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "events_league_starts_idx" ON "events" USING btree ("league_id","starts_at");;
CREATE INDEX IF NOT EXISTS "events_status_idx" ON "events" USING btree ("status");;
CREATE INDEX IF NOT EXISTS "hedge_strategies_user_idx" ON "hedge_strategies" USING btree ("user_id");;
CREATE INDEX IF NOT EXISTS "hedge_strategies_market_idx" ON "hedge_strategies" USING btree ("market_id");;
CREATE INDEX IF NOT EXISTS "hedge_strategies_status_idx" ON "hedge_strategies" USING btree ("status");;
CREATE INDEX IF NOT EXISTS "leagues_sport_idx" ON "leagues" USING btree ("sport_id");;
CREATE INDEX IF NOT EXISTS "leagues_coverage_idx" ON "leagues" USING btree ("coverage");;
CREATE INDEX IF NOT EXISTS "market_outcomes_market_idx" ON "market_outcomes" USING btree ("market_id");;
CREATE INDEX IF NOT EXISTS "market_positions_user_idx" ON "market_positions" USING btree ("user_id");;
CREATE INDEX IF NOT EXISTS "market_positions_market_idx" ON "market_positions" USING btree ("market_id");;
CREATE INDEX IF NOT EXISTS "market_positions_wallet_idx" ON "market_positions" USING btree ("wallet_address");;
CREATE INDEX IF NOT EXISTS "markets_state_idx" ON "markets" USING btree ("state");;
CREATE INDEX IF NOT EXISTS "markets_event_idx" ON "markets" USING btree ("event_id");;
CREATE INDEX IF NOT EXISTS "resolutions_market_idx" ON "resolutions" USING btree ("market_id");;

CREATE TABLE IF NOT EXISTS "market_fills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "address" varchar(42) NOT NULL,
  "market_id" varchar(66) NOT NULL,
  "direction" varchar(4) NOT NULL,
  "tokens_raw" varchar(32) NOT NULL,
  "usdc_raw" varchar(32) NOT NULL,
  "tx_hash" varchar(66) NOT NULL UNIQUE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
ALTER TABLE "market_fills" ADD CONSTRAINT "market_fills_market_id_markets_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("market_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "market_fills_addr_market_idx" ON "market_fills" ("address","market_id");
