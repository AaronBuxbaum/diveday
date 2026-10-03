-- Removes the dive-support record (ADR 20260827-support-needs-are-a-record-about-the-dive, withdrawn
-- 2026-10-03 at the owner's request during the Divers page cleanup). Its reader and writer are
-- deleted in the same change; nothing in this release reads the table.
--
-- diveday:allow-destructive drop-table dive_support_needs: feature removed at the owner's request (ADR 20260827-support-needs-are-a-record-about-the-dive withdrawn); its reader and writer are already deleted, pre-pilot, no users (H-49)

DROP TABLE "dive_support_needs";