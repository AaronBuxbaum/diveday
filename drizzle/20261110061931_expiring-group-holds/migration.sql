ALTER TABLE "bookings" ADD COLUMN "group_hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "group_hold_expired_at" timestamp with time zone;