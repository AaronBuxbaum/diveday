ALTER TABLE "booking_checkouts" ADD COLUMN "customer_email" text;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "abandoned_recovery_sent_at" timestamp with time zone;