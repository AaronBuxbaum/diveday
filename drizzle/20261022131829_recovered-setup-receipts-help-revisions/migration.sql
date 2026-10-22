ALTER TABLE "trip_help_requests" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD COLUMN "helper_person_id" uuid;--> statement-breakpoint
ALTER TABLE "setup_requests" ADD COLUMN "receipt_status" text;--> statement-breakpoint
ALTER TABLE "setup_requests" ADD COLUMN "receipt_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "setup_requests" ADD COLUMN "receipt_provider_message_id" varchar(256);--> statement-breakpoint
ALTER TABLE "setup_requests" ADD COLUMN "receipt_error_code" text;--> statement-breakpoint
CREATE INDEX "setup_requests_receipt_claimed_idx" ON "setup_requests" ("receipt_claimed_at");--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_helper_person_id_people_id_fkey" FOREIGN KEY ("helper_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "setup_requests" ADD CONSTRAINT "setup_requests_receipt_status_check" CHECK ("receipt_status" in ('pending', 'claimed', 'accepted', 'failed', 'unknown', 'suppressed'));--> statement-breakpoint
ALTER TABLE "setup_requests" ADD CONSTRAINT "setup_requests_receipt_error_check" CHECK ("receipt_error_code" in ('address_cooldown', 'global_limit', 'not_configured', 'invalid_test_recipient', 'throttled', 'rejected', 'provider_rejected', 'provider_unavailable', 'network_error', 'invalid_response', 'send_exception'));