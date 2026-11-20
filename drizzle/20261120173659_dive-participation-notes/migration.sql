CREATE TYPE "dive_participation" AS ENUM('dived', 'sat_out', 'unknown');--> statement-breakpoint
CREATE TABLE "dive_participation_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"dive_number" integer NOT NULL,
	"participation" "dive_participation" NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "dive_participation_notes_dive_number_positive" CHECK ("dive_number" >= 1)
);
--> statement-breakpoint
CREATE INDEX "dive_participation_notes_shop_trip_idx" ON "dive_participation_notes" ("shop_id","trip_id","booking_id","dive_number","seq");--> statement-breakpoint
CREATE INDEX "dive_participation_notes_booking_idx" ON "dive_participation_notes" ("booking_id");--> statement-breakpoint
CREATE INDEX "dive_participation_notes_recorded_by_person_id_idx" ON "dive_participation_notes" ("recorded_by_person_id");--> statement-breakpoint
ALTER TABLE "dive_participation_notes" ADD CONSTRAINT "dive_participation_notes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_participation_notes" ADD CONSTRAINT "dive_participation_notes_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "dive_participation_notes" ADD CONSTRAINT "dive_participation_notes_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "dive_participation_notes" ADD CONSTRAINT "dive_participation_notes_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");