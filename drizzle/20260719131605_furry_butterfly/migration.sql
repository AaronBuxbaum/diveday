CREATE TABLE "trip_dives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"trip_id" uuid NOT NULL,
	"dive_number" integer NOT NULL,
	"title" text,
	"dive_site_id" uuid,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trip_dives_trip_number_unique" ON "trip_dives" ("trip_id","dive_number");--> statement-breakpoint
CREATE INDEX "trip_dives_trip_idx" ON "trip_dives" ("trip_id","dive_number");--> statement-breakpoint
ALTER TABLE "trip_dives" ADD CONSTRAINT "trip_dives_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_dives" ADD CONSTRAINT "trip_dives_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
UPDATE "trips"
SET "planned_dives" = LEAST(GREATEST("planned_dives", 1), 4)
WHERE "planned_dives" < 1 OR "planned_dives" > 4;--> statement-breakpoint
INSERT INTO "trip_dives" ("trip_id", "dive_number", "dive_site_id")
SELECT "trips"."id", series.number, CASE WHEN series.number = 1 THEN "trips"."dive_site_id" ELSE NULL END
FROM "trips"
CROSS JOIN generate_series(1, 4) AS series(number)
WHERE series.number <= "trips"."planned_dives";--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_planned_dives_range" CHECK ("planned_dives" BETWEEN 1 AND 4);
