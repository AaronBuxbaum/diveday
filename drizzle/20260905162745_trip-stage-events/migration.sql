CREATE TYPE "trip_stage" AS ENUM('boarding', 'underway', 'surface', 'heading_in', 'home');--> statement-breakpoint
CREATE TABLE "trip_stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"stage" "trip_stage" NOT NULL,
	"dive_site_id" uuid,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE INDEX "trip_stage_events_shop_trip_idx" ON "trip_stage_events" ("shop_id","trip_id","recorded_at","seq");--> statement-breakpoint
ALTER TABLE "trip_stage_events" ADD CONSTRAINT "trip_stage_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_stage_events" ADD CONSTRAINT "trip_stage_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_stage_events" ADD CONSTRAINT "trip_stage_events_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trip_stage_events" ADD CONSTRAINT "trip_stage_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");