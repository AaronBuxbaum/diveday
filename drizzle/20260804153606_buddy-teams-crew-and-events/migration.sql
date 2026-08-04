CREATE TYPE "buddy_team_event_action" AS ENUM('formed', 'dissolved', 'member_added', 'member_removed');--> statement-breakpoint
CREATE TABLE "buddy_team_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"pair_id" uuid NOT NULL,
	"action" "buddy_team_event_action" NOT NULL,
	"member_names" jsonb DEFAULT '[]' NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ADD COLUMN "crew_person_id" uuid;--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ALTER COLUMN "booking_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "buddy_team_events_shop_trip_idx" ON "buddy_team_events" ("shop_id","trip_id","occurred_at");--> statement-breakpoint
CREATE INDEX "buddy_team_events_pair_idx" ON "buddy_team_events" ("pair_id");--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ADD CONSTRAINT "buddy_pair_members_crew_person_id_people_id_fkey" FOREIGN KEY ("crew_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_events" ADD CONSTRAINT "buddy_team_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_events" ADD CONSTRAINT "buddy_team_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "buddy_team_events" ADD CONSTRAINT "buddy_team_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "buddy_pair_members" ADD CONSTRAINT "buddy_pair_members_one_subject" CHECK (("booking_id" is not null) <> ("crew_person_id" is not null));