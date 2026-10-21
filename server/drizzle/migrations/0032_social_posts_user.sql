-- 0032 — posts to the user's own X account (owner, 2026-10-21): a row may
-- belong to a user instead of a deployment posting profile.
ALTER TABLE "social_posts" ALTER COLUMN "profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_posts_user_time_idx" ON "social_posts" ("user_id","created_at");
