-- Standing swap intents: guard-held swaps the agent parks for automatic
-- retry (resolve path). A peg-blocked swap parks whole; an impact-blocked
-- swap executes the largest safe clip and parks the remainder. The intent
-- sweep cron re-checks signals and fills pending intents until they
-- complete, are cancelled, or expire.
CREATE TABLE "agent_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_address" varchar(42) NOT NULL,
	"token_in" varchar(16) NOT NULL,
	"token_out" varchar(16) NOT NULL,
	"amount_in" varchar(78) NOT NULL,
	"amount_remaining" varchar(78) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"reason" text,
	"last_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_intents" ADD CONSTRAINT "agent_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "agent_intents_status_idx" ON "agent_intents" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE INDEX "agent_intents_user_idx" ON "agent_intents" USING btree ("user_id","created_at");
