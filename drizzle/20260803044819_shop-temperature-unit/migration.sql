CREATE TYPE "temperature_unit" AS ENUM('celsius', 'fahrenheit');--> statement-breakpoint
-- How a shop reads water temperature, now its own setting rather than a
-- reading of `depth_unit`. Defaults 'celsius' because storage is Celsius and
-- most of the diving world reads it.
ALTER TABLE "shops" ADD COLUMN "temperature_unit" "temperature_unit" DEFAULT 'celsius'::"temperature_unit" NOT NULL;--> statement-breakpoint
-- Then backfilled to match exactly what every existing shop was already being
-- shown. Until this column existed, `temperatureUnitFor()` derived the unit
-- from `depth_unit` (feet ⇒ Fahrenheit), so a shop set to feet has been
-- reading °F on its trip pages, recaps, and packing tips. Defaulting them all
-- to Celsius here would silently re-label every one of those surfaces on the
-- day this landed; copying the derivation forward means no shop's reading
-- changes until someone deliberately changes it in settings. Fresh installs
-- backfill nothing; the table is empty.
UPDATE "shops" SET "temperature_unit" = 'fahrenheit' WHERE "depth_unit" = 'feet';--> statement-breakpoint
-- Crew type whole degrees and whole units in the shop's own unit, and the
-- conversion to canonical Celsius/metres is not integral: 76°F is 24.44°C and
-- 50 ft is 15.24 m. As integers these read back a degree or a metre off the
-- number that was typed; as double precision they round-trip exactly, the same
-- reason `dive_sites.max_depth_meters` is floating point. Widening is lossless
-- — every stored value is already a whole number.
ALTER TABLE "trips" ALTER COLUMN "water_temperature_c" SET DATA TYPE double precision USING "water_temperature_c"::double precision;--> statement-breakpoint
ALTER TABLE "trips" ALTER COLUMN "visibility_meters" SET DATA TYPE double precision USING "visibility_meters"::double precision;
