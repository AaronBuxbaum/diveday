-- DATA-L4 (review 20260802): `image_urls` and `image_alts` were two jsonb
-- arrays whose correspondence was positional and unenforced. Nothing kept them
-- the same length, so one drifted row captioned every photo after it with the
-- previous photo's words — invisible on screen, and wrong for exactly the
-- readers alt text exists for. One object per photo makes the pairing
-- structural.
--
-- Expand only. The two old columns stay for one release and keep being written
-- (src/db/courses.ts, `legacyGalleryColumns`): the previous release is still
-- serving course pages off them while this runs inside the production build,
-- so the drop is the *contract* release's job, not this one
-- (docs/engineering/deploy-and-migrations-runbook.md).
ALTER TABLE "courses" ADD COLUMN "gallery_photos" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Zip the two old arrays on position, and decide what an *already drifted* row
-- becomes rather than leaving it to whichever array happened to be shorter:
--
--   * a url with no matching alt keeps its photo and takes an empty caption —
--     a photo is what a diver sees, so dropping one would visibly change a
--     published page, and "" is the same "no caption yet" the editor writes,
--     rendering as the generated "{title} — photo {n}" fallback;
--   * an alt with no matching url is dropped — it has nothing to caption, and
--     keeping it could only re-create the misalignment under a new name.
--
-- `jsonb_typeof(...) = 'string'` is what makes the LEFT JOIN's absent row and a
-- stored JSON `null` land on the same "" rather than on a null `alt`, since
-- coalesce alone would only catch the first. The WHERE bounds the write to rows
-- that have a photo at all; every other row already holds the column default.
UPDATE "courses" SET "gallery_photos" = coalesce((
  SELECT jsonb_agg(
           jsonb_build_object(
             'url', "u"."value",
             'alt', CASE WHEN jsonb_typeof("a"."value") = 'string' THEN "a"."value" ELSE '""'::jsonb END
           )
           ORDER BY "u"."ord"
         )
    FROM jsonb_array_elements("courses"."image_urls") WITH ORDINALITY AS "u"("value", "ord")
    LEFT JOIN jsonb_array_elements("courses"."image_alts") WITH ORDINALITY AS "a"("value", "ord")
      ON "a"."ord" = "u"."ord"
), '[]'::jsonb)
WHERE jsonb_array_length("image_urls") > 0;
