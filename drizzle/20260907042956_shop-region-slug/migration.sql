ALTER TABLE "shops" ADD COLUMN "region_slug" text;--> statement-breakpoint
CREATE INDEX "shops_region_slug_idx" ON "shops" ("region_slug");--> statement-breakpoint
-- Backfill for rows written before the column existed: the same derivation
-- `setShopAddress` runs from `regionSlugFromLocality` (src/lib/region.ts) —
-- lower-cased, every run of anything but a letter or digit folded to one
-- hyphen, outer hyphens trimmed, empty to null. Diacritics are not folded
-- here (no `unaccent` on PGlite); no pre-pilot row carries one (H-49), and the
-- next address save rewrites the slug through the TypeScript rule anyway.
UPDATE "shops" SET "region_slug" = nullif(trim(both '-' from regexp_replace(lower("address_locality"), '[^a-z0-9]+', '-', 'g')), '') WHERE "address_locality" IS NOT NULL;
