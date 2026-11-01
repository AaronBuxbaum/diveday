-- Issue #2795: `packing_logbook` now suggests the logbook, in the diver's
-- language and only where it applies. A shop that had typed it as its own
-- packing-list line would show it twice, so that line moves into the flag
-- (H-20260815-no-legacy: the data migrates; no runtime code reads the old line). Only a
-- standalone "Logbook" item matches, ignoring case and outer spaces; a line
-- that merely mentions a logbook is the shop's own wording and stays.
UPDATE "shops"
SET
  "packing_logbook" = true,
  "packing_list" = COALESCE(
    (
      SELECT jsonb_agg("item" ORDER BY "position")
      FROM jsonb_array_elements("shops"."packing_list") WITH ORDINALITY AS "items"("item", "position")
      WHERE jsonb_typeof("item") <> 'string' OR lower(btrim("item" #>> '{}')) <> 'logbook'
    ),
    '[]'::jsonb
  )
WHERE jsonb_typeof("packing_list") = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("shops"."packing_list") AS "items"("item")
    WHERE jsonb_typeof("item") = 'string' AND lower(btrim("item" #>> '{}')) = 'logbook'
  );
