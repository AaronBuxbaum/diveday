CREATE TYPE "recap_pulse_category" AS ENUM('gear', 'briefing', 'boat', 'timing', 'other');--> statement-breakpoint
CREATE TABLE "recap_pulses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"categories" jsonb DEFAULT '[]' NOT NULL,
	"note" text,
	"addressed_at" timestamp with time zone,
	"addressed_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recap_pulses_live_has_category" CHECK ("deleted_at" is not null or jsonb_array_length("categories") > 0),
	CONSTRAINT "recap_pulses_addressed_has_actor" CHECK (("addressed_at" is null) = ("addressed_by_person_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recap_pulses_booking_live_unique" ON "recap_pulses" ("booking_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "recap_pulses_shop_open_idx" ON "recap_pulses" ("shop_id","created_at") WHERE "addressed_at" is null and "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "recap_pulses" ADD CONSTRAINT "recap_pulses_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recap_pulses" ADD CONSTRAINT "recap_pulses_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "recap_pulses" ADD CONSTRAINT "recap_pulses_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "recap_pulses" ADD CONSTRAINT "recap_pulses_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "recap_pulses" ADD CONSTRAINT "recap_pulses_addressed_by_person_id_people_id_fkey" FOREIGN KEY ("addressed_by_person_id") REFERENCES "people"("id");