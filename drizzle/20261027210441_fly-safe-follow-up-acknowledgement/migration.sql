ALTER TABLE "bookings" ADD COLUMN "fly_safe_acknowledgement_fingerprint" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "fly_safe_acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "fly_safe_acknowledged_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_fly_safe_acknowledged_by_person_id_people_id_fkey" FOREIGN KEY ("fly_safe_acknowledged_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;