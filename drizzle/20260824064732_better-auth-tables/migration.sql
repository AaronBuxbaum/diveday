CREATE TABLE "account_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_account_id" uuid NOT NULL,
	"token" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"person_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"shop_slug" text NOT NULL,
	"roles" jsonb NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_account_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "account_sessions_user_account_idx" ON "account_sessions" ("user_account_id");--> statement-breakpoint
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id");--> statement-breakpoint
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "account_sessions" ADD CONSTRAINT "account_sessions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "auth_provider_accounts" ADD CONSTRAINT "auth_provider_accounts_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id");