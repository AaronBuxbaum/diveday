ALTER TABLE "bookings" ADD COLUMN "reschedule_missed_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reschedule_missed_place" boolean DEFAULT false NOT NULL;