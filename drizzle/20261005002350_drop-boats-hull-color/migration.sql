-- Removes the boat hull colour. Its only reader was the hull drawn above a departure's roster,
-- removed at the owner's request during the trip page cleanup (2026-10-05); the Settings field and
-- the export column are deleted in the same change, so nothing in this release reads it.
--
-- diveday:allow-destructive drop-column boats.hull_color: the drawn hull was removed at the owner's request; its reader and writer are already deleted, pre-pilot, no users (H-49)
ALTER TABLE "boats" DROP COLUMN "hull_color";