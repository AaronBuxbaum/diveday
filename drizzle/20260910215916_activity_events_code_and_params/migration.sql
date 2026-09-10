-- **The trail stops carrying its own English.**
--
-- `message` held a sentence built in `src/db` and printed verbatim, so every
-- shop's history read English whatever language its staff had chosen, and the
-- guard that forbids prose in the data layer could not see it (issue #1655). A
-- row now holds a code from `src/lib/activity.ts` and the names its sentence
-- needs; `src/i18n/activity-labels.ts` picks the words.
--
-- Existing rows are deleted rather than backfilled. There is no mapping from a
-- free sentence back to a code, and DiveDay is pre-pilot with no shop whose
-- history this is (`.claude/rules/db.md`, H-49). The delete also makes the
-- `NOT NULL` on `code` addable without a default nobody would ever mean.
-- diveday:allow-destructive delete-without-where activity_events: pre-pilot, no users, H-49 -- these rows are English sentences with no mapping back to a code
--
-- **What the previous release does while this runs, stated plainly.** It does
-- not merely read this table: it writes it on every check-in, seating, note and
-- crew change. Adding `code` NOT NULL with no default and dropping `message`
-- makes every one of those inserts fail until the new build is serving, and in
-- `checkInBooking` the insert shares a transaction with the booking's own status
-- change, so a shop cannot check a diver in for the length of the swap. There is
-- no expand/contract shape that avoids it while still removing the column, and
-- H-49 is the only reason that is acceptable: there are no users to be standing
-- at a counter when it happens. It stops being acceptable the moment there are
-- (`.claude/rules/db.md`).
DELETE FROM "activity_events";--> statement-breakpoint
-- diveday:allow-destructive drop-constraint activity_events.activity_events_message_not_blank: the column it guards is dropped four statements below, so the constraint has nothing left to guard
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_message_not_blank";--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "params" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- diveday:allow-destructive drop-column activity_events.message: pre-pilot, no users, H-49 -- the table is emptied above, so this drops a column with no rows under it, and the replacement code/params pair is added in the same migration
ALTER TABLE "activity_events" DROP COLUMN "message";--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_code_not_blank" CHECK (length(trim("code")) > 0);
