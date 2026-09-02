-- Comment thread on a game's market page (the Polymarket-style detail
-- view). Keyed by the provider event id — not the market id — so one
-- thread covers both outcome markets and survives market re-creation.
CREATE TABLE "market_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_id" varchar(128) NOT NULL,
	"address" varchar(42) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "market_comments_event_idx" ON "market_comments" USING btree ("provider_event_id","created_at");
