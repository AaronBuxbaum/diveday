CREATE TYPE "rental_fit_item" AS ENUM('bcd', 'wetsuit', 'boots', 'mask_fins', 'weights');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "carried_facts_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "fit_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "fit_confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "fit_confirmed_item" "rental_fit_item";--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_fit_confirmed_by_people_id_fkey" FOREIGN KEY ("fit_confirmed_by") REFERENCES "people"("id");