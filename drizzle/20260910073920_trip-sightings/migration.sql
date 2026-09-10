CREATE TABLE "trip_sightings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"dive_site_id" uuid NOT NULL,
	"dive_site_name" text NOT NULL,
	"species_slug" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_sightings_count_positive" CHECK ("count" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trip_sightings_trip_site_species_live_unique" ON "trip_sightings" ("trip_id","dive_site_id","species_slug") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "trip_sightings_shop_trip_idx" ON "trip_sightings" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "trip_sightings_site_recorded_idx" ON "trip_sightings" ("dive_site_id","recorded_at");--> statement-breakpoint
ALTER TABLE "trip_sightings" ADD CONSTRAINT "trip_sightings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_sightings" ADD CONSTRAINT "trip_sightings_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_sightings" ADD CONSTRAINT "trip_sightings_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "trip_sightings" ADD CONSTRAINT "trip_sightings_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_sightings" ADD CONSTRAINT "trip_sightings_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");