-- diveday:allow-destructive alter-column-type bookings.status: drops the enum value 'checked_in' (issue #2702, ADR 20261104-arrival-is-a-trail); every row was moved to 'booked' by the previous migration, the table is small and pre-pilot, and the previous release only fails a desk check-in tapped during the deploy itself, which the desk taps again; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-default bookings.status: restored to 'booked' at the end of this same migration
-- diveday:allow-destructive drop-type booking_status: recreated at once without 'checked_in'; only bookings.status uses booking_status
ALTER TABLE "bookings" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
DROP TYPE "booking_status";--> statement-breakpoint
CREATE TYPE "booking_status" AS ENUM('booked', 'cancelled', 'no_show');--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "status" SET DATA TYPE "booking_status" USING "status"::"booking_status";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'booked'::"booking_status";