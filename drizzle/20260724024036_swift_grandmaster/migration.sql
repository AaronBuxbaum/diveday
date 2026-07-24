ALTER TABLE "shops" ALTER COLUMN "rental_items" SET DEFAULT '["bcd","regulator","wetsuit","mask_fins","weights","dive_computer"]';
--> statement-breakpoint
-- Backfill (H-06): shops still on the previous five-item core default gain the
-- dive computer, now part of the default rental kit. Customized catalogs — any
-- shop that added or removed items — are left exactly as they are.
UPDATE "shops"
SET "rental_items" = "rental_items" || '["dive_computer"]'::jsonb
WHERE "rental_items" = '["bcd","regulator","wetsuit","mask_fins","weights"]'::jsonb;