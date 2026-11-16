ALTER TABLE "bookings" ADD COLUMN "course_followup_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "course_followup_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "course_followup_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_course_followup_by_person_id_people_id_fkey" FOREIGN KEY ("course_followup_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_course_followup_attributed" CHECK (("course_followup_at" is null) = ("course_followup_by_person_id" is null));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_course_followup_revision" CHECK ("course_followup_revision" >= 0);