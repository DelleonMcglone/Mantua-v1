-- Cross-provider event identity (R-012): a game ingested from one provider
-- can be refreshed by another. `provider_ids` maps provider name -> that
-- provider's event id for every provider that has described the row;
-- (provider, provider_event_id) stays the row's canonical identity.
ALTER TABLE "events" ADD COLUMN "provider_ids" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
UPDATE "events" SET "provider_ids" = jsonb_build_object("provider", "provider_event_id") WHERE "provider_ids" = '{}'::jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_league_teams_starts_idx" ON "events" ("league_id", "home_team_key", "away_team_key", "starts_at");
