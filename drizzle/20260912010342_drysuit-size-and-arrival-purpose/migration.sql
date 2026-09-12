ALTER TYPE "booking_capability_purpose" ADD VALUE 'arrival';--> statement-breakpoint
ALTER TYPE "rental_fit_item" ADD VALUE 'drysuit';--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "drysuit_size" text;