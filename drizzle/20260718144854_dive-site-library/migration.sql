CREATE TABLE "dive_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"location_name" text,
	"satellite_image_url" text,
	"route_image_url" text,
	"image_urls" jsonb DEFAULT '[]' NOT NULL,
	"marine_life" text,
	"marine_life_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "dive_site_id" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "conditions_summary" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "water_temperature_c" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "visibility_meters" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "surface_conditions" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "conditions_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "dive_sites_shop_name_unique" ON "dive_sites" ("shop_id","name");--> statement-breakpoint
CREATE INDEX "dive_sites_shop_name_idx" ON "dive_sites" ("shop_id","name");--> statement-breakpoint
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");