CREATE TABLE "course_elearning_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"booking_id" uuid,
	"assigned_at" timestamp with time zone,
	"assigned_by_person_id" uuid,
	CONSTRAINT "course_elearning_codes_named" CHECK (length(btrim("code")) > 0),
	CONSTRAINT "course_elearning_codes_assigned_pair" CHECK (("booking_id" is null) = ("assigned_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "course_elearning_codes_code_unique" ON "course_elearning_codes" ("shop_id","course_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "course_elearning_codes_booking_unique" ON "course_elearning_codes" ("booking_id") WHERE "booking_id" is not null;--> statement-breakpoint
CREATE INDEX "course_elearning_codes_stock_idx" ON "course_elearning_codes" ("shop_id","course_id","created_at") WHERE "booking_id" is null;--> statement-breakpoint
ALTER TABLE "course_elearning_codes" ADD CONSTRAINT "course_elearning_codes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_elearning_codes" ADD CONSTRAINT "course_elearning_codes_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "course_elearning_codes" ADD CONSTRAINT "course_elearning_codes_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "course_elearning_codes" ADD CONSTRAINT "course_elearning_codes_assigned_by_person_id_people_id_fkey" FOREIGN KEY ("assigned_by_person_id") REFERENCES "people"("id");