CREATE TABLE "trip_schedule_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"trip_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_schedule_days_ends_after_starts" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trip_schedule_days_trip_day_unique" ON "trip_schedule_days" ("trip_id","day_number");--> statement-breakpoint
CREATE INDEX "trip_schedule_days_trip_starts_idx" ON "trip_schedule_days" ("trip_id","starts_at");--> statement-breakpoint
ALTER TABLE "trip_schedule_days" ADD CONSTRAINT "trip_schedule_days_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;
--> statement-breakpoint
INSERT INTO "trip_schedule_days" ("trip_id", "day_number", "starts_at", "ends_at")
SELECT "id", 1, "starts_at", "ends_at" FROM "trips"
ON CONFLICT ("trip_id", "day_number") DO NOTHING;
