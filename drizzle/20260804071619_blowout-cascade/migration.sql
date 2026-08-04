CREATE TYPE "blowout_message_status" AS ENUM('pending', 'sending', 'sent', 'queued', 'failed', 'no_email');--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE 'trip_blowout';--> statement-breakpoint
CREATE TABLE "trip_blowout_divers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"blowout_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"message_status" "blowout_message_status" DEFAULT 'pending'::"blowout_message_status" NOT NULL,
	"notified_at" timestamp with time zone,
	"offered_trip_ids" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_blowouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"called_by_person_id" uuid NOT NULL,
	"called_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trip_blowout_divers_booking_unique" ON "trip_blowout_divers" ("booking_id");--> statement-breakpoint
CREATE INDEX "trip_blowout_divers_blowout_idx" ON "trip_blowout_divers" ("blowout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_blowouts_trip_unique" ON "trip_blowouts" ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_blowouts_shop_called_idx" ON "trip_blowouts" ("shop_id","called_at");--> statement-breakpoint
ALTER TABLE "trip_blowout_divers" ADD CONSTRAINT "trip_blowout_divers_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_blowout_divers" ADD CONSTRAINT "trip_blowout_divers_blowout_id_trip_blowouts_id_fkey" FOREIGN KEY ("blowout_id") REFERENCES "trip_blowouts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_blowout_divers" ADD CONSTRAINT "trip_blowout_divers_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "trip_blowout_divers" ADD CONSTRAINT "trip_blowout_divers_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_blowouts" ADD CONSTRAINT "trip_blowouts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_blowouts" ADD CONSTRAINT "trip_blowouts_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "trip_blowouts" ADD CONSTRAINT "trip_blowouts_called_by_person_id_people_id_fkey" FOREIGN KEY ("called_by_person_id") REFERENCES "people"("id");