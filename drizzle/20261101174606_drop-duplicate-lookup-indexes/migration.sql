-- diveday:allow-destructive drop-constraint trips.trips_dive_site_id_dive_sites_id_fkey: no code reads or writes trips.dive_site_id since #3237 (planned sites live in trip_dives), pre-pilot, no users (H-20260815-no-legacy); the previous release already stopped naming it (#3237)
ALTER TABLE "trips" DROP CONSTRAINT "trips_dive_site_id_dive_sites_id_fkey";--> statement-breakpoint
DROP INDEX "booking_capabilities_token_hash_idx";--> statement-breakpoint
DROP INDEX "calendar_feeds_token_hash_idx";--> statement-breakpoint
DROP INDEX "dive_sites_shop_name_idx";--> statement-breakpoint
DROP INDEX "global_dive_sites_slug_idx";--> statement-breakpoint
DROP INDEX "person_courtesy_email_unsubscribe_tokens_token_hash_idx";--> statement-breakpoint
DROP INDEX "rental_fit_profiles_shop_person_idx";--> statement-breakpoint
DROP INDEX "interest_unsubscribe_tokens_token_hash_idx";--> statement-breakpoint
-- diveday:allow-destructive drop-column trips.dive_site_id: no code reads or writes trips.dive_site_id since #3237 (planned sites live in trip_dives), pre-pilot, no users (H-20260815-no-legacy); the previous release already stopped naming it (#3237)
ALTER TABLE "trips" DROP COLUMN "dive_site_id";