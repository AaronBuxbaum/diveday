CREATE TYPE "course_inquiry_experience" AS ENUM('never', 'tried', 'certified', 'lapsed');--> statement-breakpoint
CREATE TABLE "course_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"experience_level" "course_inquiry_experience" NOT NULL,
	"timing" text,
	"divers" integer,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "course_inquiries_shop_created_idx" ON "course_inquiries" ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "course_inquiries_course_idx" ON "course_inquiries" ("course_id");--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD CONSTRAINT "course_inquiries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD CONSTRAINT "course_inquiries_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");