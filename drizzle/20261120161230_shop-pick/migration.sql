ALTER TABLE "shops" ADD COLUMN "pick_trip_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "pick_course_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_one_pick" CHECK ("pick_trip_id" is null or "pick_course_id" is null);