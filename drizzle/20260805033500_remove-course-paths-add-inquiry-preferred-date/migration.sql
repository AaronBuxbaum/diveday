ALTER TABLE "course_path_steps" DROP CONSTRAINT "course_path_steps_path_id_course_paths_id_fkey";--> statement-breakpoint
DROP TABLE "course_path_steps";--> statement-breakpoint
DROP TABLE "course_paths";--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD COLUMN "preferred_date" date;