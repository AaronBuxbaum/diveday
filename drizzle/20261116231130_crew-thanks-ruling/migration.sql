-- diveday:allow-destructive drop-constraint trip_reviews.trip_reviews_crew_thanks_hidden_by_person_id_people_id_fkey: the column it guards is dropped in this migration; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-constraint trip_reviews.trip_reviews_crew_thanks_pair: replaced in this migration by trip_reviews_crew_thanks_shape, which admits every row the old one did plus a one-tap thanks with no line; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column trip_reviews.crew_thanks_hidden_at: staff now pass a thanks on before the crew sees it (issue #4261); pre-pilot, no users, and a hide written by the previous release during the deploy window is lost, which is acceptable (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column trip_reviews.crew_thanks_hidden_by_person_id: dropped with crew_thanks_hidden_at (issue #4261); pre-pilot, no users (H-20260815-no-legacy)
CREATE TYPE "crew_thanks_ruling" AS ENUM('passed', 'held');--> statement-breakpoint
ALTER TABLE "trip_reviews" DROP CONSTRAINT "trip_reviews_crew_thanks_hidden_by_person_id_people_id_fkey";--> statement-breakpoint
ALTER TABLE "trip_reviews" DROP CONSTRAINT "trip_reviews_crew_thanks_pair";--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD COLUMN "crew_thanks_ruling" "crew_thanks_ruling";--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD COLUMN "crew_thanks_ruled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD COLUMN "crew_thanks_ruled_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "trip_reviews" DROP COLUMN "crew_thanks_hidden_at";--> statement-breakpoint
ALTER TABLE "trip_reviews" DROP COLUMN "crew_thanks_hidden_by_person_id";--> statement-breakpoint
DROP INDEX "trip_reviews_crew_thanks_idx";--> statement-breakpoint
CREATE INDEX "trip_reviews_crew_thanks_idx" ON "trip_reviews" ("crew_thanks_person_id","shop_id","created_at") WHERE "crew_thanks_person_id" is not null;--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_crew_thanks_ruled_by_person_id_people_id_fkey" FOREIGN KEY ("crew_thanks_ruled_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_reviews" ADD CONSTRAINT "trip_reviews_crew_thanks_shape" CHECK (("crew_thanks" is null or ("crew_thanks_person_id" is not null and length(btrim("crew_thanks")) > 0 and length("crew_thanks") <= 200)) and ("crew_thanks_ruling" is null or "crew_thanks_person_id" is not null) and (("crew_thanks_ruling" is null) = ("crew_thanks_ruled_at" is null)));