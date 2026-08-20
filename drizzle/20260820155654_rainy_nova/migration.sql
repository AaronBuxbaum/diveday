-- A real expand/contract violation, named rather than waved through: for the length
-- of the production build the previous release is still serving, and its
-- `src/db/waivers.ts` selects `archived_at`, so every waiver-template read 500s until
-- the new release takes over. Four queries behind the staff waiver surface read this
-- column and there is no shop on the platform to meet them. Doing it properly (add
-- `deleted_at`, dual-write, backfill, drop `archived_at` a release later) would be
-- three migrations spent on a table whose rows have never had a reader outside a
-- test, which is the trade H-49 settled.
-- diveday:allow-destructive rename-column waiver_templates.archived_at: pre-pilot, no users, H-49 — the only reader of this column is the staff waiver surface of a platform with no shops on it, and the deploy window is the whole exposure
ALTER TABLE "waiver_templates" RENAME COLUMN "archived_at" TO "deleted_at";
