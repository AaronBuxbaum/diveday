ALTER TYPE "security_step_up_purpose" ADD VALUE 'security';--> statement-breakpoint
CREATE TABLE "account_passkey_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid,
	"user_account_id" uuid,
	"account_session_id" uuid,
	"token_hash" text NOT NULL UNIQUE,
	"challenge" text NOT NULL,
	"ceremony" text NOT NULL,
	"purpose" text,
	"origin" text NOT NULL,
	"rp_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_passkey_challenges_binding" CHECK (("ceremony" = 'sign-in' and "user_account_id" is null and "account_session_id" is null and "shop_id" is null and "purpose" is null) or ("ceremony" in ('register', 'step-up') and "user_account_id" is not null and "account_session_id" is not null and "shop_id" is not null and (("ceremony" = 'register' and "purpose" is null) or ("ceremony" = 'step-up' and "purpose" is not null and "purpose" in ('money', 'export', 'backup', 'security')))))
);
--> statement-breakpoint
CREATE TABLE "account_passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"user_account_id" uuid NOT NULL,
	"credential_id" text NOT NULL UNIQUE,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "account_passkeys_counter" CHECK ("counter" >= 0),
	CONSTRAINT "account_passkeys_name" CHECK (length("name") between 1 and 80)
);
--> statement-breakpoint
CREATE INDEX "account_passkey_challenges_expiry_idx" ON "account_passkey_challenges" ("expires_at");--> statement-breakpoint
CREATE INDEX "account_passkeys_live_account_idx" ON "account_passkeys" ("user_account_id") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "account_passkey_challenges" ADD CONSTRAINT "account_passkey_challenges_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_passkey_challenges" ADD CONSTRAINT "account_passkey_challenges_IAoJPG6JDKcK_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_passkey_challenges" ADD CONSTRAINT "account_passkey_challenges_WpffnZM0oTSQ_fkey" FOREIGN KEY ("account_session_id") REFERENCES "account_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_passkeys" ADD CONSTRAINT "account_passkeys_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_passkeys" ADD CONSTRAINT "account_passkeys_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE;