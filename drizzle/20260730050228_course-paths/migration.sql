CREATE TABLE "course_path_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"path_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "course_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "course_path_steps_path_position_unique" ON "course_path_steps" ("path_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "course_path_steps_path_course_unique" ON "course_path_steps" ("path_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_paths_shop_title_unique" ON "course_paths" ("shop_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX "course_paths_shop_slug_unique" ON "course_paths" ("shop_id","slug");--> statement-breakpoint
CREATE INDEX "course_paths_shop_active_idx" ON "course_paths" ("shop_id","is_active");--> statement-breakpoint
ALTER TABLE "course_path_steps" ADD CONSTRAINT "course_path_steps_path_id_course_paths_id_fkey" FOREIGN KEY ("path_id") REFERENCES "course_paths"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "course_path_steps" ADD CONSTRAINT "course_path_steps_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "course_paths" ADD CONSTRAINT "course_paths_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");