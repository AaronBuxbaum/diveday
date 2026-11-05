-- Waiver links are derived from their record (ADR 20260820-waiver-links-are-reused-not-reissued, amended 2026-11-05).
-- The previous release stopped declaring the sealed copy and cleared it; drop it now (#3903).
-- diveday:allow-destructive drop-column waiver_records.token_sealed: waiver links are derived from their record; no schema declares it since #3903's first half and the previous release cleared it; pre-pilot, no users (H-20260815-no-legacy) (issue #3903)
ALTER TABLE "waiver_records" DROP COLUMN "token_sealed";
