ALTER TABLE "dive_sites" ADD COLUMN "depth_min_meters" double precision;--> statement-breakpoint
-- Read the range out of the prose where it can be read: "6–12 m", "20 to 45 ft", "15–28 m (50–90 ft)".
-- Only when the upper figure is the site's recorded maximum (or none is recorded), so a range never
-- contradicts the number a certification ceiling is compared against; anything else stays as the note. A prose bound at or past 30 m over a recorded maximum under 30 m also stays
-- (20–30 m, max 29.7): the note is what still reads that site as demanding.
UPDATE "dive_sites" AS d
SET "depth_min_meters" = p.lo,
    "max_depth_meters" = COALESCE(d."max_depth_meters", p.hi),
    "depth_range" = NULL
FROM (
  SELECT x."id",
         x.m[1]::double precision * x.f AS lo,
         x.m[2]::double precision * x.f AS hi
  FROM (
    SELECT s."id",
           regexp_match(s."depth_range", '^\s*(\d+(?:\.\d+)?)\s*(?:–|—|-|to|a)\s*(\d+(?:\.\d+)?)\s*(m|metros|ft|feet|pies)\y(?:\s*\([^)]*\))?\s*$', 'i') AS m,
           CASE WHEN lower((regexp_match(s."depth_range", '^\s*(\d+(?:\.\d+)?)\s*(?:–|—|-|to|a)\s*(\d+(?:\.\d+)?)\s*(m|metros|ft|feet|pies)\y(?:\s*\([^)]*\))?\s*$', 'i'))[3]) IN ('m', 'metros') THEN 1.0 ELSE 0.3048 END AS f
    FROM "dive_sites" s
    WHERE s."depth_range" IS NOT NULL
  ) x
  WHERE x.m IS NOT NULL
) p
WHERE d."id" = p."id"
  AND p.lo >= 0
  AND p.lo < p.hi
  AND p.hi <= 300
  AND (d."max_depth_meters" IS NULL OR abs(d."max_depth_meters" - p.hi) <= 0.5)
  AND NOT (p.hi >= 30 AND COALESCE(d."max_depth_meters" < 30, false))
  AND p.lo <= COALESCE(d."max_depth_meters", p.hi);--> statement-breakpoint
-- "Up to 18 m": a deepest point and nothing else.
UPDATE "dive_sites" AS d
SET "max_depth_meters" = COALESCE(d."max_depth_meters", p.hi),
    "depth_range" = NULL
FROM (
  SELECT x."id",
         x.m[1]::double precision * x.f AS hi
  FROM (
    SELECT s."id",
           regexp_match(s."depth_range", '^\s*(?:up to|to|hasta)\s*(\d+(?:\.\d+)?)\s*(m|metros|ft|feet|pies)\y(?:\s*\([^)]*\))?\s*$', 'i') AS m,
           CASE WHEN lower((regexp_match(s."depth_range", '^\s*(?:up to|to|hasta)\s*(\d+(?:\.\d+)?)\s*(m|metros|ft|feet|pies)\y(?:\s*\([^)]*\))?\s*$', 'i'))[2]) IN ('m', 'metros') THEN 1.0 ELSE 0.3048 END AS f
    FROM "dive_sites" s
    WHERE s."depth_range" IS NOT NULL
  ) x
  WHERE x.m IS NOT NULL
) p
WHERE d."id" = p."id"
  AND p.hi > 0
  AND p.hi <= 300
  AND (d."max_depth_meters" IS NULL OR abs(d."max_depth_meters" - p.hi) <= 0.5)
  AND NOT (p.hi >= 30 AND COALESCE(d."max_depth_meters" < 30, false));--> statement-breakpoint
-- The catalog's published briefings (DiveDay's own words) carry the same two numbers now, not the prose.
UPDATE "global_dive_site_versions" AS v
SET "briefing" = v."briefing" || jsonb_build_object('depthMinMeters', p.lo)
FROM (
  SELECT x."id",
         x.m[1]::double precision * x.f AS lo,
         x.m[2]::double precision * x.f AS hi
  FROM (
    SELECT g."id",
           regexp_match(g."briefing"->>'depthRange', '^\s*(\d+(?:\.\d+)?)\s*(?:–|—|-|to|a)\s*(\d+(?:\.\d+)?)\s*(m|metros|ft|feet|pies)\y(?:\s*\([^)]*\))?\s*$', 'i') AS m,
           CASE WHEN lower((regexp_match(g."briefing"->>'depthRange', '^\s*(\d+(?:\.\d+)?)\s*(?:–|—|-|to|a)\s*(\d+(?:\.\d+)?)\s*(m|metros|ft|feet|pies)\y(?:\s*\([^)]*\))?\s*$', 'i'))[3]) IN ('m', 'metros') THEN 1.0 ELSE 0.3048 END AS f
    FROM "global_dive_site_versions" g
    WHERE g."briefing" ? 'depthRange'
  ) x
  WHERE x.m IS NOT NULL
) p
WHERE v."id" = p."id"
  AND p.lo >= 0
  AND p.lo < p.hi
  AND abs(COALESCE((v."briefing"->>'maxDepthMeters')::double precision, p.hi) - p.hi) <= 0.5;--> statement-breakpoint
UPDATE "global_dive_site_versions" SET "briefing" = "briefing" - 'depthRange' WHERE "briefing" ? 'depthRange';--> statement-breakpoint
ALTER TABLE "dive_sites" ADD CONSTRAINT "dive_sites_depth_range_ordered" CHECK ("depth_min_meters" is null
        or ("depth_min_meters" >= 0
          and "max_depth_meters" is not null
          and "depth_min_meters" <= "max_depth_meters"));