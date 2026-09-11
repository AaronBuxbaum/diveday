ALTER TABLE "booking_checkouts" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "tips" ADD COLUMN "stripe_customer_id" text;