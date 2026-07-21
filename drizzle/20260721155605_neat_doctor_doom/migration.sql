ALTER TABLE "booking_checkouts" ADD COLUMN "is_deposit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "deposit_cents" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "cancellation_window_hours" integer;