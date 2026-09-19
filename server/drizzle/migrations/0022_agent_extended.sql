-- Task 070 (Phase 13, AE-001 … AE-014) — agent social profiles, the post
-- record, support tickets, and the fill-immutability trigger.
--
-- Idempotent (IF NOT EXISTS / duplicate_object guards) per the 0009
-- convention.

-- ── AE-014 — market_fills is append-only at the database ─────────────────
-- The public ledger is derived from chain-verified fills. No application
-- code updates or deletes a fill; this trigger makes that a property of the
-- database rather than a habit, so a losing trade cannot be edited or
-- dropped by a direct write either. (A market is never deleted, so the
-- cascade from `markets` is not a path anything takes.)
CREATE OR REPLACE FUNCTION mantua_refuse_fill_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'market_fills is append-only (task 070, AE-014): % refused', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS market_fills_immutable ON "market_fills";
--> statement-breakpoint
CREATE TRIGGER market_fills_immutable
  BEFORE UPDATE OR DELETE ON "market_fills"
  FOR EACH ROW EXECUTE FUNCTION mantua_refuse_fill_mutation();
--> statement-breakpoint

-- ── agent_social_profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "agent_social_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" varchar(24) NOT NULL,
	"display_name" varchar(48) NOT NULL,
	"bio" varchar(280) DEFAULT '' NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"platform" varchar(16) DEFAULT 'x' NOT NULL,
	"posting_enabled" boolean DEFAULT false NOT NULL,
	"posting_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_social_profiles" ADD CONSTRAINT "agent_social_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_social_profiles_user_uq" ON "agent_social_profiles" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_social_profiles_handle_uq" ON "agent_social_profiles" USING btree ("handle");
--> statement-breakpoint

-- ── social_posts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"template" varchar(24) NOT NULL,
	"market_id" varchar(66),
	"text" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_profile_id_agent_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_social_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_posts_profile_time_idx" ON "social_posts" USING btree ("profile_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_posts_market_idx" ON "social_posts" USING btree ("market_id","template");
--> statement-breakpoint

-- ── support_tickets ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"category" varchar(16) NOT NULL,
	"summary" text NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"channel" varchar(16) DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_status_time_idx" ON "support_tickets" USING btree ("status","created_at");
