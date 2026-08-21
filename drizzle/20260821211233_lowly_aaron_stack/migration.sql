ALTER TABLE "rental_fit_profiles" ADD COLUMN "fit_stated_at" timestamp with time zone;
--> statement-breakpoint
-- Every row that exists today was written by a fit save — `saveRentalFitNote`,
-- the only other writer, ships in this same change. So `updated_at` is an
-- accurate answer to "when was a fit last stated" for all of them, and
-- backfilling it keeps every existing diver reading as a recorded fit rather
-- than silently dropping off the packing list the moment this deploys.
UPDATE "rental_fit_profiles" SET "fit_stated_at" = "updated_at" WHERE "fit_stated_at" IS NULL;
