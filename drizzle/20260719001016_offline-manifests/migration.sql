CREATE TYPE "roll_call_source" AS ENUM('live', 'offline');--> statement-breakpoint
DROP INDEX "roll_call_events_shop_trip_booking_created_idx";--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD COLUMN "checkpoint" text DEFAULT 'departure' NOT NULL;--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD COLUMN "source" "roll_call_source" DEFAULT 'live'::"roll_call_source" NOT NULL;--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD COLUMN "client_event_id" uuid;--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD COLUMN "offline_snapshot_saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "planned_dives" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
CREATE INDEX "roll_call_events_shop_trip_checkpoint_booking_occurred_idx" ON "roll_call_events" ("shop_id","trip_id","checkpoint","booking_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roll_call_events_shop_client_event_unique" ON "roll_call_events" ("shop_id","client_event_id");