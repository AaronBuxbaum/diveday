CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"minimum_certification_level" "certification_level",
	"requires_instructor" boolean DEFAULT true NOT NULL,
	"requires_waiver" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_gear_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"bcd" boolean DEFAULT true NOT NULL,
	"regulator" boolean DEFAULT true NOT NULL,
	"wetsuit" boolean DEFAULT true NOT NULL,
	"mask_fins" boolean DEFAULT true NOT NULL,
	"weights" boolean DEFAULT true NOT NULL,
	"tank" boolean DEFAULT true NOT NULL,
	"dive_computer" boolean DEFAULT false NOT NULL,
	"bcd_size" text,
	"wetsuit_size" text,
	"boot_size" text,
	"fin_size" text,
	"weight_preference" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_requirements" ALTER COLUMN "minimum_certification_level" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_gear_requests" ADD CONSTRAINT "rental_gear_requests_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_gear_requests" ADD CONSTRAINT "rental_gear_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "courses_shop_title_unique" ON "courses" USING btree ("shop_id","title");--> statement-breakpoint
CREATE INDEX "courses_shop_active_idx" ON "courses" USING btree ("shop_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_gear_requests_booking_unique" ON "rental_gear_requests" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "rental_gear_requests_shop_booking_idx" ON "rental_gear_requests" USING btree ("shop_id","booking_id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;