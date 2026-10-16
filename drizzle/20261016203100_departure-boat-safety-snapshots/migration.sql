CREATE TABLE "departure_boat_safety_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"boat_id" uuid NOT NULL,
	"boat_name" text NOT NULL,
	"judged_on" date NOT NULL,
	"papers" jsonb NOT NULL,
	"notices" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "departure_boat_safety_snapshots_trip_idx" ON "departure_boat_safety_snapshots" ("trip_id");--> statement-breakpoint
CREATE INDEX "departure_boat_safety_snapshots_shop_idx" ON "departure_boat_safety_snapshots" ("shop_id");--> statement-breakpoint
ALTER TABLE "departure_boat_safety_snapshots" ADD CONSTRAINT "departure_boat_safety_snapshots_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "departure_boat_safety_snapshots" ADD CONSTRAINT "departure_boat_safety_snapshots_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "departure_boat_safety_snapshots" ADD CONSTRAINT "departure_boat_safety_snapshots_boat_id_boats_id_fkey" FOREIGN KEY ("boat_id") REFERENCES "boats"("id");