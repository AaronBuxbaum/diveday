ALTER TABLE "account_security" ADD COLUMN "totp_secret_key_id" text;--> statement-breakpoint
ALTER TABLE "account_security" ADD COLUMN "recovery_codes_key_id" text;