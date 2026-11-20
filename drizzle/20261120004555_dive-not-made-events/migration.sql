CREATE TYPE "dive_not_made_word" AS ENUM('not_made', 'undone');--> statement-breakpoint
CREATE TABLE "dive_not_made_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"dive_number" integer NOT NULL,
	"meeting_day" integer NOT NULL,
	"word" "dive_not_made_word" NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "dive_not_made_events_dive_number_positive" CHECK ("dive_number" >= 1),
	CONSTRAINT "dive_not_made_events_meeting_day_nonnegative" CHECK ("meeting_day" >= 0)
);
--> statement-breakpoint
CREATE INDEX "dive_not_made_events_recorded_by_person_id_idx" ON "dive_not_made_events" ("recorded_by_person_id");--> statement-breakpoint
CREATE INDEX "dive_not_made_events_shop_trip_idx" ON "dive_not_made_events" ("shop_id","trip_id","meeting_day","dive_number","recorded_at","seq");--> statement-breakpoint
ALTER TABLE "dive_not_made_events" ADD CONSTRAINT "dive_not_made_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_not_made_events" ADD CONSTRAINT "dive_not_made_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dive_not_made_events" ADD CONSTRAINT "dive_not_made_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");