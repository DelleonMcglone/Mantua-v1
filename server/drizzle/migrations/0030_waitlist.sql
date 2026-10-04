-- 0030 — the pre-launch waitlist: one row per (lower-cased) email.
CREATE TABLE IF NOT EXISTS "waitlist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(254) NOT NULL,
  "source" varchar(32) DEFAULT 'landing' NOT NULL,
  "user_agent" varchar(200),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
