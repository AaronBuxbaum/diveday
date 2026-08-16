CREATE TABLE "trip_recap_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"uploaded_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trip_recap_photos_shop_trip_idx" ON "trip_recap_photos" ("shop_id","trip_id","created_at");--> statement-breakpoint
ALTER TABLE "trip_recap_photos" ADD CONSTRAINT "trip_recap_photos_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_recap_photos" ADD CONSTRAINT "trip_recap_photos_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_recap_photos" ADD CONSTRAINT "trip_recap_photos_uploaded_by_person_id_people_id_fkey" FOREIGN KEY ("uploaded_by_person_id") REFERENCES "people"("id");