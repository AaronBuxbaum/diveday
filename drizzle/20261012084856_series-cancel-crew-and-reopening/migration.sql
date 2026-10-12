CREATE TYPE "trip_blowout_cause" AS ENUM('weather', 'run_ended');--> statement-breakpoint
CREATE TABLE "trip_series_crew" (
	"shop_id" uuid NOT NULL,
	"series_id" uuid,
	"person_id" uuid,
	"trip_role" "trip_assignment_role",
	CONSTRAINT "trip_series_crew_pkey" PRIMARY KEY("series_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "reopens_on" text;--> statement-breakpoint
ALTER TABLE "trip_blowouts" ADD COLUMN "cause" "trip_blowout_cause" DEFAULT 'weather'::"trip_blowout_cause" NOT NULL;--> statement-breakpoint
CREATE INDEX "trip_series_crew_shop_idx" ON "trip_series_crew" ("shop_id");--> statement-breakpoint
CREATE INDEX "trip_series_crew_person_idx" ON "trip_series_crew" ("person_id");--> statement-breakpoint
ALTER TABLE "trip_series_crew" ADD CONSTRAINT "trip_series_crew_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_series_crew" ADD CONSTRAINT "trip_series_crew_series_id_trip_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "trip_series"("id");--> statement-breakpoint
ALTER TABLE "trip_series_crew" ADD CONSTRAINT "trip_series_crew_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_reopens_on_is_a_date" CHECK ("reopens_on" is null or "reopens_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');