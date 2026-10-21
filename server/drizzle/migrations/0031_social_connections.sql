-- 0031 — a user's own X account, connected through OAuth 2.0 so the agent
-- can post as them (owner, 2026-10-21). Tokens are sealed before storage.
CREATE TABLE IF NOT EXISTS "social_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "platform" varchar(16) DEFAULT 'x' NOT NULL,
  "external_user_id" varchar(32) NOT NULL,
  "handle" varchar(32) NOT NULL,
  "display_name" varchar(64) DEFAULT '' NOT NULL,
  "access_token_sealed" text,
  "refresh_token_sealed" text,
  "scopes" varchar(160) DEFAULT '' NOT NULL,
  "expires_at" timestamp with time zone,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_connections_user_platform_uq" ON "social_connections" ("user_id","platform");
