CREATE TYPE "dive_site_difficulty" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TABLE "marine_life_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"requested_by_person_id" uuid NOT NULL,
	"query" text NOT NULL,
	"dive_site_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "difficulty_level" "dive_site_difficulty";--> statement-breakpoint
CREATE INDEX "marine_life_requests_created_idx" ON "marine_life_requests" ("created_at");--> statement-breakpoint
ALTER TABLE "marine_life_requests" ADD CONSTRAINT "marine_life_requests_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "marine_life_requests" ADD CONSTRAINT "marine_life_requests_requested_by_person_id_people_id_fkey" FOREIGN KEY ("requested_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "marine_life_requests" ADD CONSTRAINT "marine_life_requests_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Backfill: every value any shop or template ever stored in `difficulty` was
-- already one of these three words, so the code column starts where the free
-- text left off and no site loses its reading. Bounded by a WHERE and matching
-- only exact values -- anything else a shop typed is left null, which renders
-- as "crew-led" rather than as a guess about what they meant.
UPDATE "dive_sites" SET "difficulty_level" = lower(btrim("difficulty"))::"dive_site_difficulty"
WHERE "difficulty_level" IS NULL
  AND lower(btrim("difficulty")) IN ('beginner', 'intermediate', 'advanced');
