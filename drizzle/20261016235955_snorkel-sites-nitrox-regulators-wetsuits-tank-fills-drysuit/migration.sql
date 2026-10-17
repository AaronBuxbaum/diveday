ALTER TABLE "people" ADD COLUMN "drysuit_experience_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "drysuit_experience_seen_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "drysuit_experience_seen_note" text;--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "snorkel_suitable" boolean;--> statement-breakpoint
ALTER TABLE "gear_items" ADD COLUMN "nitrox_designated" boolean;--> statement-breakpoint
ALTER TABLE "gear_items" ADD COLUMN "thickness_mm" integer;--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD COLUMN "fill_o2_percent" integer;--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD COLUMN "fill_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD COLUMN "fill_recorded_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "wetsuit_thickness_mm" integer;--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_fill_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("fill_recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_thickness_mm_range" CHECK ("thickness_mm" is null or "thickness_mm" between 1 and 10);--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_fill_o2_percent" CHECK ("fill_o2_percent" is null or ("booking_id" is null and "fill_o2_percent" >= 21 and "fill_o2_percent" <= 40));--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_fill_recorded" CHECK (("fill_o2_percent" is null) = ("fill_recorded_at" is null));--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_wetsuit_thickness_mm_range" CHECK ("wetsuit_thickness_mm" is null or "wetsuit_thickness_mm" between 1 and 10);