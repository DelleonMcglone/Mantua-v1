-- Task 067 (Phase 10, G-014) — recorded legal acceptances: which Terms
-- version each user agreed to, and when. Unique per (user, doc, version)
-- so a re-submitted acceptance is a no-op and a version bump asks once.
--
-- Idempotent (IF NOT EXISTS) per the 0009 convention.
CREATE TABLE IF NOT EXISTS "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"doc" varchar(16) NOT NULL,
	"version" varchar(16) NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "legal_acceptances_user_doc_version_idx" ON "legal_acceptances" USING btree ("user_id","doc","version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legal_acceptances_user_idx" ON "legal_acceptances" USING btree ("user_id");
