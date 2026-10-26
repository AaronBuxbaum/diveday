CREATE TABLE "account_sign_in_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"user_account_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts_remaining" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_sign_in_challenges_attempts" CHECK ("attempts_remaining" between 0 and 5),
	CONSTRAINT "account_sign_in_challenges_expiry" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE INDEX "account_sign_in_challenges_expiry_idx" ON "account_sign_in_challenges" ("expires_at");--> statement-breakpoint
CREATE INDEX "account_sign_in_challenges_account_idx" ON "account_sign_in_challenges" ("user_account_id");--> statement-breakpoint
ALTER TABLE "account_sign_in_challenges" ADD CONSTRAINT "account_sign_in_challenges_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_sign_in_challenges" ADD CONSTRAINT "account_sign_in_challenges_daJGGk9AeHDX_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE;