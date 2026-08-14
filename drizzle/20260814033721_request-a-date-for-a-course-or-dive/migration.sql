ALTER TABLE "course_inquiries" ADD COLUMN "interest" text;--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD COLUMN "preferred_date" date;--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD COLUMN "alternate_date" date;--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD COLUMN "date_flexible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "course_inquiries" ALTER COLUMN "course_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "course_inquiries_shop_preferred_date_idx" ON "course_inquiries" ("shop_id","preferred_date");--> statement-breakpoint
ALTER TABLE "course_inquiries" ADD CONSTRAINT "course_inquiries_subject_present" CHECK ("course_id" is not null or length(btrim(coalesce("interest", ''))) > 0);