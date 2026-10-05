CREATE TYPE "identity_match_kind" AS ENUM('shared_email', 'picked_name');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "identity_booked_as" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "identity_matched_by" "identity_match_kind";