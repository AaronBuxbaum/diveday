CREATE TYPE "trip_change_event_kind" AS ENUM('meeting_point', 'conditions');--> statement-breakpoint
CREATE TYPE "trip_change_event_source" AS ENUM('shop', 'crew');--> statement-breakpoint
CREATE TYPE "trip_help_request_kind" AS ENUM('carry_gear', 'first_timer', 'find_group');--> statement-breakpoint
CREATE TYPE "trip_help_request_status" AS ENUM('requested', 'acknowledged', 'handled', 'withdrawn');--> statement-breakpoint
ALTER TYPE "media_deletion_kind" ADD VALUE 'arrival_photo';--> statement-breakpoint
CREATE TABLE "trip_change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" "trip_change_event_kind" NOT NULL,
	"source" "trip_change_event_source" NOT NULL,
	"before_value" jsonb DEFAULT 'null',
	"after_value" jsonb NOT NULL,
	"actor_person_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "trip_help_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "trip_help_request_kind" NOT NULL,
	"status" "trip_help_request_status" DEFAULT 'requested'::"trip_help_request_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"handled_at" timestamp with time zone,
	"resolved_by_person_id" uuid
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "arrival_landmark" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "arrival_parking_note" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "arrival_transit_note" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "arrival_look_for" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "arrival_first_interaction" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "arrival_photo_url" text;--> statement-breakpoint
CREATE INDEX "trip_change_events_shop_trip_idx" ON "trip_change_events" ("shop_id","trip_id","occurred_at","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_help_requests_booking_unique" ON "trip_help_requests" ("booking_id");--> statement-breakpoint
CREATE INDEX "trip_help_requests_shop_status_idx" ON "trip_help_requests" ("shop_id","status","created_at");--> statement-breakpoint
CREATE INDEX "trip_help_requests_trip_idx" ON "trip_help_requests" ("trip_id","created_at");--> statement-breakpoint
ALTER TABLE "trip_change_events" ADD CONSTRAINT "trip_change_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_change_events" ADD CONSTRAINT "trip_change_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_change_events" ADD CONSTRAINT "trip_change_events_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_help_requests" ADD CONSTRAINT "trip_help_requests_resolved_by_person_id_people_id_fkey" FOREIGN KEY ("resolved_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;