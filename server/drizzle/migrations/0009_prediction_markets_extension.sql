-- Prediction-markets schema extension, in two parts.
--
-- Part 1 — BASELINE: the B0-005 sports-market tables (sports, leagues,
-- events, markets, market_outcomes, market_positions, resolutions,
-- hedge_strategies, market_fills) were created via drizzle push and never
-- had a CREATE migration, so a fresh database could not be built from this
-- chain (0008 used to fail on the missing "markets"). They are baselined
-- here with IF NOT EXISTS — existing databases skip them wholesale. The
-- markets table is created in its post-0008 shape (chain_id 8453, widened
-- unique) since 0008 no-ops on a fresh database.
--
-- Part 2 — EXTENSION: teams / players / injuries catalog, market price
-- history, combos (schema ahead of the feature — nothing writes them yet),
-- per-user agent policies, and the user-facing activity feed. Games are the
-- existing "events" table; it gains relational team links here.

-- ─── Part 1: baseline ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(32) NOT NULL UNIQUE,
	"name" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport_id" uuid NOT NULL REFERENCES "public"."sports"("id") ON DELETE cascade,
	"slug" varchar(32) NOT NULL UNIQUE,
	"name" varchar(64) NOT NULL,
	"coverage" varchar(8) DEFAULT 'soon' NOT NULL,
	"provider_key" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leagues_sport_idx" ON "leagues" USING btree ("sport_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leagues_coverage_idx" ON "leagues" USING btree ("coverage");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL REFERENCES "public"."leagues"("id") ON DELETE cascade,
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
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_league_starts_idx" ON "events" USING btree ("league_id","starts_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_status_idx" ON "events" USING btree ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "markets" (
	"market_id" varchar(66) PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL REFERENCES "public"."events"("id") ON DELETE cascade,
	"market_type" varchar(16) DEFAULT 'moneyline' NOT NULL,
	"outcome_index" smallint NOT NULL,
	"chain_id" integer DEFAULT 8453 NOT NULL,
	"state" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"yes_token" varchar(42),
	"no_token" varchar(42),
	"pool_id" varchar(66),
	"opening_probability" numeric(6, 5),
	"frozen_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_event_type_outcome_chain_uq" UNIQUE("event_id","market_type","outcome_index","chain_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_state_idx" ON "markets" USING btree ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_event_idx" ON "markets" USING btree ("event_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar(66) NOT NULL REFERENCES "public"."markets"("market_id") ON DELETE cascade,
	"outcome_index" smallint NOT NULL,
	"label" varchar(96) NOT NULL,
	"is_winner" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_outcomes_market_index_uq" UNIQUE("market_id","outcome_index")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_outcomes_market_idx" ON "market_outcomes" USING btree ("market_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"market_id" varchar(66) NOT NULL REFERENCES "public"."markets"("market_id") ON DELETE cascade,
	"wallet_address" varchar(42) NOT NULL,
	"side" varchar(3) NOT NULL,
	"size" numeric(78, 0) NOT NULL,
	"entry_price" numeric(6, 5),
	"redeemed_at" timestamp with time zone,
	"redeem_tx_hash" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_positions_user_idx" ON "market_positions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_positions_market_idx" ON "market_positions" USING btree ("market_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_positions_wallet_idx" ON "market_positions" USING btree ("wallet_address");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar(66) NOT NULL REFERENCES "public"."markets"("market_id") ON DELETE cascade,
	"winning_outcome_index" smallint,
	"method" varchar(8) NOT NULL,
	"source" varchar(64),
	"source_payload" jsonb,
	"signer" varchar(42),
	"tx_hash" varchar(66),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resolutions_market_idx" ON "resolutions" USING btree ("market_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hedge_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"market_id" varchar(66) REFERENCES "public"."markets"("market_id") ON DELETE cascade,
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
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hedge_strategies_user_idx" ON "hedge_strategies" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hedge_strategies_market_idx" ON "hedge_strategies" USING btree ("market_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hedge_strategies_status_idx" ON "hedge_strategies" USING btree ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" varchar(42) NOT NULL,
	"market_id" varchar(66) NOT NULL REFERENCES "public"."markets"("market_id") ON DELETE cascade,
	"direction" varchar(4) NOT NULL,
	"tokens_raw" varchar(32) NOT NULL,
	"usdc_raw" varchar(32) NOT NULL,
	"tx_hash" varchar(66) NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_fills_addr_market_idx" ON "market_fills" USING btree ("address","market_id");
--> statement-breakpoint

-- ─── Part 2: extension ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL REFERENCES "public"."leagues"("id") ON DELETE cascade,
	"key" varchar(64) NOT NULL,
	"name" varchar(96) NOT NULL,
	"short_name" varchar(48),
	"abbreviation" varchar(8),
	"logo_url" varchar(512),
	"provider" varchar(32),
	"provider_team_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_league_key_uq" UNIQUE("league_id","key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_league_idx" ON "teams" USING btree ("league_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL REFERENCES "public"."leagues"("id") ON DELETE cascade,
	"team_id" uuid REFERENCES "public"."teams"("id") ON DELETE set null,
	"name" varchar(96) NOT NULL,
	"position" varchar(16),
	"jersey_number" smallint,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_player_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_provider_uq" UNIQUE("provider","provider_player_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "players_team_idx" ON "players" USING btree ("team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "players_league_idx" ON "players" USING btree ("league_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "injuries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL REFERENCES "public"."players"("id") ON DELETE cascade,
	"team_id" uuid REFERENCES "public"."teams"("id") ON DELETE set null,
	"status" varchar(16) NOT NULL,
	"description" varchar(256),
	"provider" varchar(32) NOT NULL,
	"provider_updated_at" timestamp with time zone,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "injuries_player_idx" ON "injuries" USING btree ("player_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "injuries_team_idx" ON "injuries" USING btree ("team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "injuries_open_idx" ON "injuries" USING btree ("resolved_at");
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "home_team_id" uuid;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "away_team_id" uuid;
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_home_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_away_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar(66) NOT NULL REFERENCES "public"."markets"("market_id") ON DELETE cascade,
	"implied_probability" numeric(6, 5) NOT NULL,
	"source" varchar(16) DEFAULT 'pool' NOT NULL,
	"liquidity_raw" numeric(78, 0),
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_prices_market_time_idx" ON "market_prices" USING btree ("market_id","captured_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "combos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"wallet_address" varchar(42) NOT NULL,
	"status" varchar(8) DEFAULT 'draft' NOT NULL,
	"stake_raw" numeric(78, 0),
	"combined_odds" numeric(12, 6),
	"potential_payout_raw" numeric(78, 0),
	"placed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "combos_user_idx" ON "combos" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "combos_status_idx" ON "combos" USING btree ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "combo_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"combo_id" uuid NOT NULL REFERENCES "public"."combos"("id") ON DELETE cascade,
	"market_id" varchar(66) NOT NULL REFERENCES "public"."markets"("market_id") ON DELETE cascade,
	"side" varchar(3) NOT NULL,
	"entry_price" numeric(6, 5),
	"result" varchar(8) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "combo_legs_combo_market_uq" UNIQUE("combo_id","market_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "combo_legs_market_idx" ON "combo_legs" USING btree ("market_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
	"status" varchar(8) DEFAULT 'active' NOT NULL,
	"auto_trade_enabled" boolean DEFAULT false NOT NULL,
	"max_stake_per_trade_usd" numeric(20, 2) DEFAULT '25' NOT NULL,
	"risk_level" varchar(12) DEFAULT 'conservative' NOT NULL,
	"allowed_leagues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_policies_user_uq" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid REFERENCES "public"."users"("id") ON DELETE cascade,
	"wallet_address" varchar(42),
	"kind" varchar(24) NOT NULL,
	"summary" text NOT NULL,
	"ref_id" varchar(128),
	"tx_hash" varchar(66),
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_user_time_idx" ON "activity" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_kind_idx" ON "activity" USING btree ("kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_ref_idx" ON "activity" USING btree ("ref_id");
