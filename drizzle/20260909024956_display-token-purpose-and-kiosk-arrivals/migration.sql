CREATE TYPE "display_token_purpose" AS ENUM('board', 'check_in');--> statement-breakpoint
ALTER TABLE "booking_arrival_events" ADD COLUMN "display_token_id" uuid;--> statement-breakpoint
ALTER TABLE "display_tokens" ADD COLUMN "purpose" "display_token_purpose" DEFAULT 'board'::"display_token_purpose" NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_arrival_events" ADD CONSTRAINT "booking_arrival_events_display_token_id_display_tokens_id_fkey" FOREIGN KEY ("display_token_id") REFERENCES "display_tokens"("id");