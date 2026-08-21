ALTER TABLE "shops" ADD COLUMN "has_boat_diving" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "shore_group_size" integer;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_shore_group_size_in_range" CHECK ("shore_group_size" > 0 and "shore_group_size" <= 60);--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_offers_some_dive_mode" CHECK ("has_boat_diving" or "has_shore_diving" or "has_pool_diving");