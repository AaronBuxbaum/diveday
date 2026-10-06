ALTER TYPE "certification_agency" ADD VALUE 'nss_cds' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "certification_agency" ADD VALUE 'nacd' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "certification_agency" ADD VALUE 'iantd' BEFORE 'other';--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "dives_dry" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- H-78 (issues #1752, #1800): a rented drysuit is a dry diver, and a dry diver
-- is not renting a wetsuit. The two updates bring any row written before the
-- fact existed into line so the checks can be added; DiveDay is pre-pilot
-- (H-49) and every environment reseeds, so they run over seed rows only. A row
-- asking for both suits keeps the drysuit, the more demanding suit, which is the
-- same answer `saveRentalFit` gives a post that ticks both.
UPDATE "rental_fit_profiles" SET "dives_dry" = true WHERE "rents_drysuit";--> statement-breakpoint
UPDATE "rental_fit_profiles" SET "rents_wetsuit" = false WHERE "dives_dry" AND "rents_wetsuit";--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_rented_drysuit_is_dry" CHECK (not "rents_drysuit" or "dives_dry");--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD CONSTRAINT "rental_fit_profiles_dry_rents_no_wetsuit" CHECK (not ("dives_dry" and "rents_wetsuit"));