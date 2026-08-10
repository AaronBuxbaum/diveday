CREATE TABLE "trip_series_skips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"occurrence_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- NOT NULL *with a default*, because migrations run inside the production build
-- while the previous release is still serving: that release's `createTripSeries`
-- inserts a trip_series row naming neither column, and a NOT NULL column with no
-- default would turn every one of those inserts into an error for the length of
-- the deploy. Both defaults are inert sentinels — an empty weekday set and an
-- empty anchor date are both refused by `seriesOccurrenceDates`, so a row written
-- by the old release generates nothing, which is exactly what that release
-- expects (it materialized all of its dates up front). The back-fill below
-- replaces them on every row that predates this migration.
ALTER TABLE "trip_series" ADD COLUMN "weekday_mask" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_series" ADD COLUMN "anchor_date" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_series" ADD COLUMN "ends_on" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "series_occurrence_date" text;--> statement-breakpoint
-- Every existing instance was materialized on its own start date, so that date
-- *is* its cadence slot. Resolved in the shop's own timezone, never the
-- server's: a 6am Key Largo departure stored as 11:00Z belongs to the day the
-- boat leaves the dock.
UPDATE "trips" AS t
SET "series_occurrence_date" = (t."starts_at" AT TIME ZONE sh."timezone")::date::text
FROM "shops" AS sh
WHERE sh."id" = t."shop_id" AND t."series_id" IS NOT NULL;--> statement-breakpoint
-- A pre-existing series was a finite, fully materialized batch. `ends_on` is
-- therefore its own last date: the horizon roll finds nothing left to add, so an
-- upgraded shop's board does not silently grow overnight. Staff clear the end
-- date from the trip page when they want the run to keep going.
UPDATE "trip_series" AS s
SET
	"anchor_date" = bounds."first_date",
	"ends_on" = bounds."last_date",
	-- Legacy series repeat on one weekday, so the first instance's weekday is the
	-- whole set. OR-ing every instance's weekday would read a date staff had
	-- *moved* as a second departure day the shop never asked for.
	"weekday_mask" = (1 << bounds."first_dow")
FROM (
	SELECT
		t."series_id" AS "series_id",
		MIN((t."starts_at" AT TIME ZONE sh."timezone")::date)::text AS "first_date",
		MAX((t."starts_at" AT TIME ZONE sh."timezone")::date)::text AS "last_date",
		EXTRACT(DOW FROM MIN(t."starts_at" AT TIME ZONE sh."timezone"))::int AS "first_dow"
	FROM "trips" AS t
	JOIN "shops" AS sh ON sh."id" = t."shop_id"
	WHERE t."series_id" IS NOT NULL
	GROUP BY t."series_id"
) AS bounds
WHERE bounds."series_id" = s."id";--> statement-breakpoint
-- A series whose every instance was deleted has nothing to read a cadence off.
-- It keeps a summary line and generates nothing; its own creation day is the
-- only honest anchor left.
UPDATE "trip_series" AS s
SET
	"anchor_date" = (s."created_at" AT TIME ZONE sh."timezone")::date::text,
	"ends_on" = (s."created_at" AT TIME ZONE sh."timezone")::date::text,
	"weekday_mask" = (1 << EXTRACT(DOW FROM s."created_at" AT TIME ZONE sh."timezone")::int)
FROM "shops" AS sh
WHERE sh."id" = s."shop_id" AND s."anchor_date" = '';--> statement-breakpoint
CREATE UNIQUE INDEX "trip_series_skips_slot_idx" ON "trip_series_skips" ("series_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "trip_series_skips_shop_idx" ON "trip_series_skips" ("shop_id");--> statement-breakpoint
ALTER TABLE "trip_series_skips" ADD CONSTRAINT "trip_series_skips_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_series_skips" ADD CONSTRAINT "trip_series_skips_series_id_trip_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "trip_series"("id");