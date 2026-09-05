ALTER TABLE "bookings" ADD COLUMN "course_next_step" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "course_next_step_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "course_next_step_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "planning_note" text;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "planning_note_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "planning_note_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "welcome_note" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "dock_call_note" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "sign_off_note" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_course_next_step_by_person_id_people_id_fkey" FOREIGN KEY ("course_next_step_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_planning_note_by_person_id_people_id_fkey" FOREIGN KEY ("planning_note_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_course_next_step_attributed" CHECK (("course_next_step" is null) = ("course_next_step_at" is null)
        and ("course_next_step_at" is null) = ("course_next_step_by_person_id" is null));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_course_next_step_bounded" CHECK ("course_next_step" is null
        or (length(btrim("course_next_step")) > 0 and length("course_next_step") <= 280));--> statement-breakpoint
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_planning_note_attributed" CHECK (("planning_note" is null) = ("planning_note_at" is null)
        and ("planning_note_at" is null) = ("planning_note_by_person_id" is null));--> statement-breakpoint
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_planning_note_not_blank" CHECK ("planning_note" is null or length(btrim("planning_note")) > 0);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_hospitality_notes_bounded" CHECK (("welcome_note" is null or length("welcome_note") <= 280)
        and ("dock_call_note" is null or length("dock_call_note") <= 280)
        and ("sign_off_note" is null or length("sign_off_note") <= 280));