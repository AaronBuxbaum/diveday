CREATE TABLE "course_session_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"step_title" text NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_by_person_id" uuid NOT NULL,
	CONSTRAINT "course_session_progress_step_named" CHECK (length(btrim("step_title")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "course_session_progress_step_unique" ON "course_session_progress" ("shop_id","person_id","course_id","step_title");--> statement-breakpoint
CREATE INDEX "course_session_progress_course_idx" ON "course_session_progress" ("course_id");--> statement-breakpoint
ALTER TABLE "course_session_progress" ADD CONSTRAINT "course_session_progress_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_session_progress" ADD CONSTRAINT "course_session_progress_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "course_session_progress" ADD CONSTRAINT "course_session_progress_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "course_session_progress" ADD CONSTRAINT "course_session_progress_done_by_person_id_people_id_fkey" FOREIGN KEY ("done_by_person_id") REFERENCES "people"("id");