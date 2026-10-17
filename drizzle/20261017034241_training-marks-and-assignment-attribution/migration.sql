ALTER TABLE "bookings" ADD COLUMN "training_enrollment_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "training_marked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "training_marked_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "training_cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "training_cleared_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "training_cleared_reason" text;--> statement-breakpoint
ALTER TABLE "course_form_records" ADD COLUMN "signed_via_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD COLUMN "assigned_by_person_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_shop_id_id_unique" ON "bookings" ("shop_id","id");--> statement-breakpoint
CREATE INDEX "bookings_training_enrollment_idx" ON "bookings" ("training_enrollment_booking_id") WHERE "training_enrollment_booking_id" is not null;--> statement-breakpoint
CREATE INDEX "course_form_records_signed_via_idx" ON "course_form_records" ("signed_via_booking_id") WHERE "signed_via_booking_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_assignments_assigned_by_idx" ON "trip_assignments" ("assigned_by_person_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_marked_by_person_id_people_id_fkey" FOREIGN KEY ("training_marked_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_cleared_by_person_id_people_id_fkey" FOREIGN KEY ("training_cleared_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_enrollment_fk" FOREIGN KEY ("shop_id","training_enrollment_booking_id") REFERENCES "bookings"("shop_id","id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_signed_via_booking_id_bookings_id_fkey" FOREIGN KEY ("signed_via_booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD CONSTRAINT "trip_assignments_assigned_by_person_id_people_id_fkey" FOREIGN KEY ("assigned_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_mark_attributed" CHECK (("training_enrollment_booking_id" is null) = ("training_marked_at" is null)
        and ("training_marked_at" is null) = ("training_marked_by_person_id" is null));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_cleared_attributed" CHECK (("training_cleared_at" is null) = ("training_cleared_by_person_id" is null)
        and ("training_cleared_at" is null) = ("training_cleared_reason" is null)
        and ("training_cleared_reason" is null or "training_cleared_reason" in ('forms_owed', 'mark_invalid')));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_mark_not_self" CHECK ("training_enrollment_booking_id" is null or "training_enrollment_booking_id" <> "id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_signed_via_other_seat" CHECK ("signed_via_booking_id" is null or "signed_via_booking_id" <> "booking_id");