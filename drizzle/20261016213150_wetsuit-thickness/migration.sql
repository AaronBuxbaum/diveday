ALTER TABLE "gear_items" ADD COLUMN "thickness_mm" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "wetsuit_thickness_mm" integer;--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_thickness_mm_range" CHECK ("thickness_mm" is null or "thickness_mm" between 1 and 10);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_wetsuit_thickness_mm_range" CHECK ("wetsuit_thickness_mm" is null or "wetsuit_thickness_mm" between 1 and 10);