-- diveday:allow-destructive alter-column-type rental_fit_profiles.fit_confirmed_item: enum rebuild preserves current values; no pilot data and released code no longer writes the retired value (H-20260815-no-legacy)
-- diveday:allow-destructive drop-type rental_fit_item: the combined item was retired by deployed PR #2849; no pilot data (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column rental_fit_profiles.rents_mask_fins: PR #2849 is in Production and removed all readers; no pilot data (H-20260815-no-legacy)
ALTER TABLE "rental_fit_profiles" ALTER COLUMN "fit_confirmed_item" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "rental_fit_item";--> statement-breakpoint
CREATE TYPE "rental_fit_item" AS ENUM('bcd', 'wetsuit', 'boots', 'fins', 'weights', 'drysuit', 'hood', 'gloves');--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ALTER COLUMN "fit_confirmed_item" SET DATA TYPE "rental_fit_item" USING "fit_confirmed_item"::"rental_fit_item";--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" DROP COLUMN "rents_mask_fins";
