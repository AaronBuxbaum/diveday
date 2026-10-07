CREATE TYPE "participant_type" AS ENUM('diver', 'snorkeler', 'rider');--> statement-breakpoint
ALTER TYPE "trip_desk_event_kind" ADD VALUE 'now_diving';--> statement-breakpoint
ALTER TYPE "trip_desk_event_kind" ADD VALUE 'now_snorkeling';--> statement-breakpoint
ALTER TYPE "trip_desk_event_kind" ADD VALUE 'now_riding';--> statement-breakpoint
ALTER TYPE "trip_desk_event_kind" ADD VALUE 'balance_owed';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "participant_type" "participant_type" DEFAULT 'diver'::"participant_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "booked_as" "participant_type" DEFAULT 'diver'::"participant_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "diver_capacity" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "snorkeler_price_cents" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "rider_price_cents" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_nitrox_is_a_divers" CHECK (not "wants_nitrox" or "participant_type" = 'diver');--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_snorkeler_price_nonnegative" CHECK ("snorkeler_price_cents" is null or "snorkeler_price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rider_price_nonnegative" CHECK ("rider_price_cents" is null or "rider_price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_diver_capacity_range" CHECK ("diver_capacity" is null or "diver_capacity" between 1 and 60);