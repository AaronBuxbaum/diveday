-- A course whose fee included "the gear" included the scuba unit (SCUBA_UNIT_PRESET,
-- src/lib/rentals.ts), so it keeps exactly that as its set of included rental kinds
-- (issue #2796). gear_included itself stays for one release and is dropped in the next.
UPDATE "courses" SET "included_rental_kinds" = '["bcd","regulator","weights"]'::jsonb WHERE "gear_included";
