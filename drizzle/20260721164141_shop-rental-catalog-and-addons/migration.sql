ALTER TABLE "rental_fit_profiles" ADD COLUMN "rents_dive_computer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "rents_gopro" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "rental_items" jsonb DEFAULT '["bcd","regulator","wetsuit","mask_fins","weights"]' NOT NULL;