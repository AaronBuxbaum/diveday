ALTER TYPE "rental_fit_item" ADD VALUE 'fins' BEFORE 'weights';--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "rents_mask" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "rents_fins" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "rental_items" SET DEFAULT '["bcd","regulator","wetsuit","mask","fins","weights","dive_computer"]';