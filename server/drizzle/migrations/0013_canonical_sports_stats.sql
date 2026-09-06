-- 038 — canonical sports-stats extension (S-005/S-006/S-007).
--
-- Closes the data-model gaps the agent's sports answers need served from
-- our own database instead of a live provider call:
--   `game_plays`   — append-only play-by-play, unique on
--                    (event, provider, sequence) so re-ingest is a no-op;
--   `team_records` — standings/record snapshot per (team, season, type),
--                    with team season stat aggregates in a `stats` jsonb;
--   `players.season_stats` — player season aggregates keyed by season
--                    label (jsonb over a new table, per the 0009 pattern
--                    of preferring typed readers to table sprawl).
--
-- READ layer: server/src/lib/sports/history.ts. Nothing writes these yet —
-- ingestion wiring is a sibling task.
--
-- Idempotent (IF NOT EXISTS) per the 0009/0012 convention, so databases
-- that already carry these objects skip them wholesale.
CREATE TABLE IF NOT EXISTS "game_plays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL REFERENCES "public"."events"("id") ON DELETE cascade,
	"provider" varchar(32) NOT NULL,
	"sequence" integer NOT NULL,
	"period" smallint,
	"clock" varchar(16),
	"play_type" varchar(32),
	"description" text,
	"team_key" varchar(64),
	"scoring_play" boolean DEFAULT false NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_plays_event_provider_seq_uq" UNIQUE("event_id","provider","sequence")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "game_plays_event_seq_idx" ON "game_plays" USING btree ("event_id","sequence");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL REFERENCES "public"."teams"("id") ON DELETE cascade,
	"season" varchar(16) NOT NULL,
	"season_type" varchar(16) DEFAULT 'regular' NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"ties" integer DEFAULT 0 NOT NULL,
	"division_rank" smallint,
	"conference_rank" smallint,
	"points_for" integer,
	"points_against" integer,
	"streak" varchar(16),
	"home_record" varchar(16),
	"away_record" varchar(16),
	"provider" varchar(32),
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_records_team_season_uq" UNIQUE("team_id","season","season_type")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_records_team_idx" ON "team_records" USING btree ("team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_records_season_idx" ON "team_records" USING btree ("season","season_type");
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "season_stats" jsonb DEFAULT '{}'::jsonb NOT NULL;
