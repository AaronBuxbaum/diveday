ALTER TYPE "booking_capability_purpose" ADD VALUE 'claim';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "party_lead_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "bookings_party_lead_idx" ON "bookings" ("party_lead_booking_id");