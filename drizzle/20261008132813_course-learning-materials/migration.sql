ALTER TABLE "bookings" ADD COLUMN "course_materials_done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "course_materials_done_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "learning_materials" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_course_materials_done_by_person_id_people_id_fkey" FOREIGN KEY ("course_materials_done_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_course_materials_done_attributed" CHECK (("course_materials_done_at" is null) = ("course_materials_done_by_person_id" is null));