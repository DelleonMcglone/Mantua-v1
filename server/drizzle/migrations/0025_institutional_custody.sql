-- Task 073 (Phase 18, IC-001 / IC-002) — the institutional tier. An
-- institution is a segregated Circle wallet set (D-120); members' agent
-- wallets are created in it, withdrawals go only to verified custody
-- destinations under dual control, and the institution carries its own
-- caps. `agent_wallets.wallet_set_id` records which set a wallet was
-- created in (null = the retail set, for every wallet created before this).
--
-- Idempotent (IF NOT EXISTS) per the 0009 convention.
CREATE TABLE IF NOT EXISTS "institutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" varchar(48) NOT NULL,
  "name" varchar(120) NOT NULL,
  "status" varchar(12) DEFAULT 'pending' NOT NULL,
  "custodian" varchar(32) NOT NULL,
  "custodian_label" varchar(120),
  "circle_wallet_set_id" varchar(64),
  "daily_cap_usd" numeric(20, 2) DEFAULT '10000' NOT NULL,
  "per_trade_cap_usd" numeric(20, 2) DEFAULT '2500' NOT NULL,
  "approval_threshold_usd" numeric(20, 2) DEFAULT '1000' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "institutions_slug_unique" UNIQUE("slug"),
  CONSTRAINT "institutions_circle_wallet_set_id_unique" UNIQUE("circle_wallet_set_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "institution_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "institutions"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" varchar(12) NOT NULL,
  "status" varchar(12) DEFAULT 'active' NOT NULL,
  "added_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "institution_members_user_uq" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "institution_members_inst_idx" ON "institution_members" ("institution_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custody_destinations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "institutions"("id") ON DELETE CASCADE,
  "label" varchar(80) NOT NULL,
  "address" varchar(42) NOT NULL,
  "chain_id" integer DEFAULT 8453 NOT NULL,
  "status" varchar(12) DEFAULT 'pending' NOT NULL,
  "added_by" uuid NOT NULL,
  "verified_by" uuid,
  "verified_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "custody_destinations_addr_uq" UNIQUE("institution_id", "address", "chain_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custody_withdrawals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "institution_id" uuid NOT NULL REFERENCES "institutions"("id") ON DELETE CASCADE,
  "requested_by" uuid NOT NULL,
  "wallet_address" varchar(42) NOT NULL,
  "destination_id" uuid NOT NULL REFERENCES "custody_destinations"("id"),
  "symbol" varchar(16) NOT NULL,
  "amount" varchar(78) NOT NULL,
  "usd_value" numeric(20, 2) NOT NULL,
  "status" varchar(12) DEFAULT 'pending' NOT NULL,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "reason" text,
  "tx_hash" varchar(66),
  "last_error" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custody_withdrawals_inst_idx" ON "custody_withdrawals" ("institution_id", "status", "created_at");
--> statement-breakpoint
ALTER TABLE "agent_wallets" ADD COLUMN IF NOT EXISTS "wallet_set_id" varchar(64);
