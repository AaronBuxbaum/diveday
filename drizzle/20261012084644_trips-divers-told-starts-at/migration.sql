ALTER TYPE "held_send_kind" ADD VALUE 'trip_rescheduled' BEFORE 'departure_note';--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE 'trip_rescheduled';--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "divers_told_starts_at" timestamp with time zone;