CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"default_slippage_bps" varchar(8) DEFAULT '50' NOT NULL,
	"hide_small_balances" jsonb DEFAULT 'true'::jsonb NOT NULL,
	"daily_cap_usd" varchar(16) DEFAULT '500' NOT NULL,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_user_id" varchar(128) NOT NULL,
	"primary_address" varchar(42),
	"email" varchar(320),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_privy_user_id_unique" UNIQUE("privy_user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"parsed_intent" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(256),
	"mode" varchar(16) DEFAULT 'chat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_key_hash" varchar(66) NOT NULL,
	"token0" varchar(42) NOT NULL,
	"token1" varchar(42) NOT NULL,
	"fee" integer NOT NULL,
	"tick_spacing" integer NOT NULL,
	"hook_address" varchar(42),
	"hook_type" varchar(32),
	"created_tx" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pools_pool_key_hash_unique" UNIQUE("pool_key_hash")
);
--> statement-breakpoint
CREATE TABLE "portfolio_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"action" varchar(32) NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"chain_id" integer DEFAULT 8453 NOT NULL,
	"params" jsonb NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"usd_value" numeric(20, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_transactions_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"token_id" varchar(80),
	"tick_lower" integer NOT NULL,
	"tick_upper" integer NOT NULL,
	"liquidity" numeric(78, 0) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"opened_tx" varchar(66),
	"closed_tx" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"cdp_wallet_id" varchar(128) NOT NULL,
	"address" varchar(42) NOT NULL,
	"label" varchar(64),
	"daily_cap_usd" numeric(20, 2) DEFAULT '100' NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_wallets_cdp_wallet_id_unique" UNIQUE("cdp_wallet_id"),
	CONSTRAINT "agent_wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "daily_wallet_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"spend_date" date NOT NULL,
	"spent_usd" numeric(20, 2) DEFAULT '0' NOT NULL,
	"tx_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mantua_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" varchar(42),
	"action" varchar(32) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tx_hash" varchar(66),
	"chain_id" integer DEFAULT 8453 NOT NULL,
	"reason" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_transactions" ADD CONSTRAINT "portfolio_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_wallets" ADD CONSTRAINT "agent_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_primary_address_idx" ON "users" USING btree ("primary_address");--> statement-breakpoint
CREATE INDEX "chat_messages_session_idx" ON "chat_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_sessions_user_idx" ON "chat_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "portfolio_tx_user_idx" ON "portfolio_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "portfolio_tx_wallet_idx" ON "portfolio_transactions" USING btree ("wallet_address","created_at");--> statement-breakpoint
CREATE INDEX "positions_user_idx" ON "positions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "agent_wallets_user_idx" ON "agent_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_spend_wallet_date_idx" ON "daily_wallet_spend" USING btree ("wallet_address","spend_date");--> statement-breakpoint
CREATE INDEX "audit_wallet_idx" ON "mantua_audit_log" USING btree ("wallet_address","created_at");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "mantua_audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_outcome_idx" ON "mantua_audit_log" USING btree ("outcome","created_at");