ALTER TABLE "bookings" ADD COLUMN "fly_safe_correction_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "fly_safe_correction_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "fly_safe_correction_lease_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "fly_safe_correction_lease_until" timestamp with time zone;