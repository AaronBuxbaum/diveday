ALTER TABLE "auth_provider_accounts" ADD COLUMN "access_token" text;--> statement-breakpoint
ALTER TABLE "auth_provider_accounts" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "auth_provider_accounts" ADD COLUMN "id_token" text;--> statement-breakpoint
ALTER TABLE "auth_provider_accounts" ADD COLUMN "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_provider_accounts" ADD COLUMN "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_provider_accounts" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "auth_provider_accounts" ADD COLUMN "password" text;--> statement-breakpoint
ALTER TABLE "user_accounts" ALTER COLUMN "hashed_password" DROP NOT NULL;