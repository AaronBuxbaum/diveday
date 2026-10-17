ALTER TABLE "bookings" ADD COLUMN "training_enrollment_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "training_marked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "training_marked_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "training_cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "training_cleared_by_person_id" uuid;--> statement-breakpoint
CREATE INDEX "bookings_training_enrollment_idx" ON "bookings" ("training_enrollment_booking_id") WHERE "training_enrollment_booking_id" is not null;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_marked_by_person_id_people_id_fkey" FOREIGN KEY ("training_marked_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_cleared_by_person_id_people_id_fkey" FOREIGN KEY ("training_cleared_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_enrollment_fk" FOREIGN KEY ("training_enrollment_booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_mark_attributed" CHECK (("training_enrollment_booking_id" is null) = ("training_marked_at" is null)
        and ("training_marked_at" is null) = ("training_marked_by_person_id" is null));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_cleared_attributed" CHECK (("training_cleared_at" is null) = ("training_cleared_by_person_id" is null));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_mark_not_self" CHECK ("training_enrollment_booking_id" is null or "training_enrollment_booking_id" <> "id");