CREATE TABLE "nitrox_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"agency" "certification_agency" NOT NULL,
	"identifier" text NOT NULL,
	"status" "certification_status" DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nitrox_fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"gear_item_id" uuid NOT NULL,
	"oxygen_percent" integer NOT NULL,
	"max_depth_meters" integer NOT NULL,
	"max_ppo2_centibar" integer NOT NULL,
	"analyzer_signature" text NOT NULL,
	"filled_by_person_id" uuid NOT NULL,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nitrox_fills" ADD CONSTRAINT "nitrox_fills_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nitrox_fills" ADD CONSTRAINT "nitrox_fills_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nitrox_fills" ADD CONSTRAINT "nitrox_fills_gear_item_id_gear_items_id_fk" FOREIGN KEY ("gear_item_id") REFERENCES "public"."gear_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nitrox_fills" ADD CONSTRAINT "nitrox_fills_filled_by_person_id_people_id_fk" FOREIGN KEY ("filled_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nitrox_certifications_shop_person_idx" ON "nitrox_certifications" USING btree ("shop_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nitrox_certifications_shop_agency_identifier_unique" ON "nitrox_certifications" USING btree ("shop_id","agency","identifier");--> statement-breakpoint
CREATE INDEX "nitrox_fills_shop_booking_idx" ON "nitrox_fills" USING btree ("shop_id","booking_id");--> statement-breakpoint
CREATE INDEX "nitrox_fills_shop_gear_idx" ON "nitrox_fills" USING btree ("shop_id","gear_item_id");