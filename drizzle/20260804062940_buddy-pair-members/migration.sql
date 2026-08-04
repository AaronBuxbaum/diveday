CREATE TABLE "buddy_pair_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"pair_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"paired_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "buddy_pair_members_booking_unique" ON "buddy_pair_members" ("booking_id");--> statement-breakpoint
CREATE INDEX "buddy_pair_members_shop_trip_idx" ON "buddy_pair_members" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "buddy_pair_members_pair_idx" ON "buddy_pair_members" ("pair_id");--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ADD CONSTRAINT "buddy_pair_members_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ADD CONSTRAINT "buddy_pair_members_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ADD CONSTRAINT "buddy_pair_members_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ADD CONSTRAINT "buddy_pair_members_paired_by_person_id_people_id_fkey" FOREIGN KEY ("paired_by_person_id") REFERENCES "people"("id");