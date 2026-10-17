ALTER TABLE "booking_capabilities" ADD COLUMN "delivered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recap_photos" ADD COLUMN "shared_with_boat_at" timestamp with time zone;