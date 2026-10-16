ALTER TABLE "bookings" ADD COLUMN "dietary_note" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "lunch_aboard" boolean DEFAULT false NOT NULL;