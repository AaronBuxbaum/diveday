ALTER TABLE "user_accounts" ADD COLUMN "how_it_went_email" boolean;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "how_it_went_sent_at" timestamp with time zone;