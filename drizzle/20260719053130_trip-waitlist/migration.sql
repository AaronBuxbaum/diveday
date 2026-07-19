CREATE TABLE "trip_waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trip_waitlist_entries_trip_person_unique" ON "trip_waitlist_entries" ("trip_id","person_id");--> statement-breakpoint
CREATE INDEX "trip_waitlist_entries_trip_created_idx" ON "trip_waitlist_entries" ("trip_id","created_at");--> statement-breakpoint
CREATE INDEX "trip_waitlist_entries_shop_trip_idx" ON "trip_waitlist_entries" ("shop_id","trip_id");--> statement-breakpoint
ALTER TABLE "trip_waitlist_entries" ADD CONSTRAINT "trip_waitlist_entries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_waitlist_entries" ADD CONSTRAINT "trip_waitlist_entries_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_waitlist_entries" ADD CONSTRAINT "trip_waitlist_entries_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");