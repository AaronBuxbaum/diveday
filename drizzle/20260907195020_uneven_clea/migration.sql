CREATE TYPE "arrival_status" AS ENUM('arrived', 'cleared');--> statement-breakpoint
CREATE TABLE "booking_arrival_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"status" "arrival_status" NOT NULL,
	"source" "roll_call_source" DEFAULT 'live'::"roll_call_source" NOT NULL,
	"client_event_id" uuid,
	"offline_snapshot_saved_at" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE INDEX "booking_arrival_events_shop_trip_booking_occurred_idx" ON "booking_arrival_events" ("shop_id","trip_id","booking_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_arrival_events_shop_client_event_unique" ON "booking_arrival_events" ("shop_id","client_event_id");--> statement-breakpoint
ALTER TABLE "booking_arrival_events" ADD CONSTRAINT "booking_arrival_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "booking_arrival_events" ADD CONSTRAINT "booking_arrival_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "booking_arrival_events" ADD CONSTRAINT "booking_arrival_events_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "booking_arrival_events" ADD CONSTRAINT "booking_arrival_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");