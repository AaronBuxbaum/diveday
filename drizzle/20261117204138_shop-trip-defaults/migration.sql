ALTER TABLE "shops" ADD COLUMN "trip_defaults" jsonb;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "shop_default_fields" jsonb DEFAULT '[]' NOT NULL;