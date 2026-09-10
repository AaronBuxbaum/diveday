-- A dive site gains its public URL segment (N-48): /s/<shop>/sites/molasses-reef.
--
-- Added nullable, backfilled from the name, then made NOT NULL, so the column
-- can land on a table that already has rows without the previous release
-- failing its inserts mid-deploy. The backfill is the same grammar
-- `src/lib/dive-site-slug.ts` mints in TypeScript — fold to lowercase, every
-- run of non-alphanumerics to one hyphen, trim the ends, cap at 80 — with
-- `unaccent` deliberately not used (it is an extension, and the app never
-- writes a slug through this path again).
--
-- A collision between two names that fold to one segment is broken by the row
-- id, which is arbitrary but stable and unique; the app's own minting appends
-- `-2` instead. Neither can be reached by a shop that exists today: DiveDay is
-- pre-pilot (H-49) and every environment reseeds, so this backfill runs over
-- seed rows only.
ALTER TABLE "dive_sites" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "dive_sites" SET "slug" = coalesce(
  nullif(
    left(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), 80),
    ''
  ),
  'dive-site'
);--> statement-breakpoint
UPDATE "dive_sites" d
   SET "slug" = left(d."slug", 72) || '-' || left(d."id"::text, 7)
  FROM (
    SELECT "shop_id", "slug"
      FROM "dive_sites"
     WHERE "deleted_at" IS NULL
     GROUP BY "shop_id", "slug"
    HAVING count(*) > 1
  ) dup
 WHERE d."shop_id" = dup."shop_id" AND d."slug" = dup."slug" AND d."deleted_at" IS NULL;--> statement-breakpoint
-- diveday:allow-destructive set-not-null dive_sites.slug: the backfill two statements
-- above leaves no NULL behind, and the only writer that could add one during the
-- build is the staff dive-site form of a shop in production -- of which there are
-- none: DiveDay is pre-pilot (H-49), every environment reseeds, and the new code
-- that supplies a slug on every insert ships in the same release as this file.
ALTER TABLE "dive_sites" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dive_sites_shop_slug_key" ON "dive_sites" ("shop_id","slug") WHERE "deleted_at" is null;
