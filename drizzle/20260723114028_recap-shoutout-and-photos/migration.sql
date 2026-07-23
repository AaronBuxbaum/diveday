CREATE TABLE "recap_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "recap_shoutout" text;--> statement-breakpoint
CREATE INDEX "recap_photos_booking_idx" ON "recap_photos" ("booking_id","created_at");--> statement-breakpoint
CREATE INDEX "recap_photos_trip_idx" ON "recap_photos" ("trip_id","created_at");--> statement-breakpoint
ALTER TABLE "recap_photos" ADD CONSTRAINT "recap_photos_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "recap_photos" ADD CONSTRAINT "recap_photos_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "recap_photos" ADD CONSTRAINT "recap_photos_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");