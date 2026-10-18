CREATE TABLE "crew_away_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"acknowledged_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crew_away_acknowledgements_live_uidx" ON "crew_away_acknowledgements" ("trip_id","person_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "crew_away_acknowledgements_shop_trip_idx" ON "crew_away_acknowledgements" ("shop_id","trip_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "crew_away_acknowledgements_person_idx" ON "crew_away_acknowledgements" ("person_id");--> statement-breakpoint
CREATE INDEX "crew_away_acknowledgements_acknowledged_by_idx" ON "crew_away_acknowledgements" ("acknowledged_by_person_id");--> statement-breakpoint
ALTER TABLE "crew_away_acknowledgements" ADD CONSTRAINT "crew_away_acknowledgements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crew_away_acknowledgements" ADD CONSTRAINT "crew_away_acknowledgements_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crew_away_acknowledgements" ADD CONSTRAINT "crew_away_acknowledgements_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "crew_away_acknowledgements" ADD CONSTRAINT "crew_away_acknowledgements_oKUw4tDQl1AB_fkey" FOREIGN KEY ("acknowledged_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;