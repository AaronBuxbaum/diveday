CREATE TYPE "plan_change_reason" AS ENUM('current', 'weather', 'visibility', 'crew_call');--> statement-breakpoint
CREATE TYPE "trip_desk_event_kind" AS ENUM('arrival', 'seat_taken', 'seat_released', 'gear_changed', 'pickup_set', 'help_request', 'meeting_point', 'plan_changed');--> statement-breakpoint
CREATE TABLE "trip_desk_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" "trip_desk_event_kind" NOT NULL,
	"booking_id" uuid,
	"subject_person_id" uuid,
	"actor_person_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "trip_read_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"last_seen_seq" bigint DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "welcome_shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "executed_dives" ADD COLUMN "plan_change_reason" "plan_change_reason";--> statement-breakpoint
ALTER TABLE "executed_dives" ADD COLUMN "plan_change_note" text;--> statement-breakpoint
CREATE INDEX "trip_desk_events_shop_trip_idx" ON "trip_desk_events" ("shop_id","trip_id","seq");--> statement-breakpoint
CREATE INDEX "trip_desk_events_occurred_idx" ON "trip_desk_events" ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_read_marks_trip_person_unique" ON "trip_read_marks" ("trip_id","person_id");--> statement-breakpoint
CREATE INDEX "trip_read_marks_shop_seen_idx" ON "trip_read_marks" ("shop_id","last_seen_at");--> statement-breakpoint
ALTER TABLE "trip_desk_events" ADD CONSTRAINT "trip_desk_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_desk_events" ADD CONSTRAINT "trip_desk_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_desk_events" ADD CONSTRAINT "trip_desk_events_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_desk_events" ADD CONSTRAINT "trip_desk_events_subject_person_id_people_id_fkey" FOREIGN KEY ("subject_person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_desk_events" ADD CONSTRAINT "trip_desk_events_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trip_read_marks" ADD CONSTRAINT "trip_read_marks_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_read_marks" ADD CONSTRAINT "trip_read_marks_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_read_marks" ADD CONSTRAINT "trip_read_marks_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_plan_change_note_length" CHECK ("plan_change_note" is null or (length(trim("plan_change_note")) between 1 and 280));--> statement-breakpoint
ALTER TABLE "executed_dives" ADD CONSTRAINT "executed_dives_plan_change_note_needs_reason" CHECK ("plan_change_note" is null or "plan_change_reason" is not null);