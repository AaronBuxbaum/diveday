-- Removes the "Close the day" act (2026-10-05, at the owner's request). Nothing ever read the
-- recorded close except the panel that displayed it and the Year report's list of closed days, and
-- the leftover Dismiss choices only hid rows from a list that repeated Needs you. Their readers and
-- writers are deleted in the same change; nothing in this release reads either table.
--
-- diveday:allow-destructive drop-table closeout_leftover_decisions: close-the-day removed at the owner's request; its reader and writer are already deleted, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-table day_closeouts: close-the-day removed at the owner's request; its reader and writer are already deleted, pre-pilot, no users (H-49)
DROP TABLE "closeout_leftover_decisions";--> statement-breakpoint
DROP TABLE "day_closeouts";