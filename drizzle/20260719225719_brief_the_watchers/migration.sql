CREATE TYPE "trip_recurrence_frequency" AS ENUM('weekly');--> statement-breakpoint
CREATE TABLE "trip_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"frequency" "trip_recurrence_frequency" DEFAULT 'weekly'::"trip_recurrence_frequency" NOT NULL,
	"interval_weeks" integer DEFAULT 1 NOT NULL,
	"occurrence_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "series_id" uuid;--> statement-breakpoint
CREATE INDEX "trip_series_shop_idx" ON "trip_series" ("shop_id");--> statement-breakpoint
CREATE INDEX "trips_series_starts_idx" ON "trips" ("series_id","starts_at");--> statement-breakpoint
ALTER TABLE "trip_series" ADD CONSTRAINT "trip_series_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_series_id_trip_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "trip_series"("id");