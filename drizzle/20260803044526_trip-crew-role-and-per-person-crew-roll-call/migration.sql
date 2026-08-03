CREATE TYPE "trip_assignment_role" AS ENUM('instructor', 'divemaster', 'captain', 'crew');--> statement-breakpoint
CREATE TABLE "roll_call_crew_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"status" "roll_call_status" NOT NULL,
	"checkpoint" text NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD COLUMN "trip_role" "trip_assignment_role";--> statement-breakpoint
CREATE INDEX "roll_call_crew_events_shop_trip_checkpoint_person_occurred_idx" ON "roll_call_crew_events" ("shop_id","trip_id","checkpoint","person_id","occurred_at");--> statement-breakpoint
ALTER TABLE "roll_call_crew_events" ADD CONSTRAINT "roll_call_crew_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "roll_call_crew_events" ADD CONSTRAINT "roll_call_crew_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "roll_call_crew_events" ADD CONSTRAINT "roll_call_crew_events_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "roll_call_crew_events" ADD CONSTRAINT "roll_call_crew_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");