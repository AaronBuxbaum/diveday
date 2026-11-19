ALTER TABLE "bookings" ADD COLUMN "offline_assignment_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD COLUMN "offline_meeting_generation" integer;--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD COLUMN "offline_assignment_generation" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "offline_meeting_generation" integer DEFAULT 0 NOT NULL;