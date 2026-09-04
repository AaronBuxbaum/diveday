CREATE TYPE "gear_return_outcome" AS ENUM('all_good', 'fit_adjusted', 'service_concern');--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD COLUMN "return_outcome" "gear_return_outcome";