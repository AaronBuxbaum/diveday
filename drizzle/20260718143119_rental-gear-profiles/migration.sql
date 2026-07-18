CREATE TABLE "rental_gear_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"bcd_size" text,
	"wetsuit_size" text,
	"boot_size" text,
	"fin_size" text,
	"weight_preference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rental_gear_profiles_shop_person_unique" ON "rental_gear_profiles" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "rental_gear_profiles_shop_person_idx" ON "rental_gear_profiles" ("shop_id","person_id");--> statement-breakpoint
ALTER TABLE "rental_gear_profiles" ADD CONSTRAINT "rental_gear_profiles_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "rental_gear_profiles" ADD CONSTRAINT "rental_gear_profiles_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");