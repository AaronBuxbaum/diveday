-- Dropping the dead wait-list link on `trip_invitations` (issue #1616).
--
-- Every statement below is destructive by the guard's reading, and every one of
-- them is safe here for the same two reasons: the column has never held a row,
-- and DiveDay is pre-pilot (H-49). Nothing writes `source: 'waitlist'` — both
-- insert sites in `src/db/trip-invitations.ts` pass 'date_request' or 'direct'
-- — so `waitlist_entry_id` has never been populated and the `waitlist` branch
-- of the check constraint has never matched a row.
--
-- The reason it goes rather than staying harmlessly: the column carries a
-- foreign key into `trip_waitlist_entries` with no `onDelete`, and
-- `anonymizeDiver` hard-deletes a diver's wait-list rows. One populated row
-- would have raised 23503 inside the erasure transaction and rolled back every
-- other redaction with it. `anonymizeDiver` wraps its work in a transaction
-- with no try/catch and `eraseDiverAction` has no handler either, so the owner
-- would have seen a server-action error rather than a false success — the
-- failure is total and opaque rather than silent, which is bad in a different
-- way and worth stating accurately.
--
-- diveday:allow-destructive drop-constraint trip_invitations_ARj7Ut08RxVu_fkey: the foreign key is on waitlist_entry_id, a column no row has ever populated, so no cascade or upsert in either release depends on it
-- diveday:allow-destructive alter-column-type trip_invitations.source: covers both ALTER COLUMN steps. The first drops to text with no USING, which is a legal enum-to-text I/O conversion that cannot lose a value; the second casts back, and the enum it casts into lost only a value no row carries, so every row lands on the value it already had. A row that did carry it would fail the cast loudly rather than silently
-- diveday:allow-destructive drop-type trip_invitation_source: recreated one statement later in the same migration, and the previous release writes only the two values that survive the recreation
-- diveday:allow-destructive drop-column trip_invitations.waitlist_entry_id: pre-pilot, no users, H-49 — the previous release DOES name this column in SQL, so this would break its reads if anyone were served by it
-- diveday:allow-destructive drop-constraint trip_invitations_source_reference_check: re-added at the end of this same migration as the identical check minus the branch whose column no longer exists, and it gates inserts only — the previous release writes date_request and direct, both of which the new check accepts

-- Statement order is hand-set, and that is worth flagging: `.claude/rules/db.md`
-- says migrations are generated, never hand-edited. What drizzle-kit generated
-- here does not apply. It put the check-constraint swap *last*, and the check
-- compares `source` against enum literals — so the `SET DATA TYPE text` in the
-- middle failed with `operator does not exist: text = trip_invitation_source`
-- against PGlite before any of it reached a review. The statements are the
-- generated ones unchanged; only their order moved, so that the constraint
-- depending on the type is dropped before the type changes and re-added after.
-- The snapshot beside this file is still the generated one and still matches
-- `src/db/schema.ts`.

ALTER TABLE "trip_invitations" DROP CONSTRAINT "trip_invitations_source_reference_check";--> statement-breakpoint
ALTER TABLE "trip_invitations" DROP CONSTRAINT "trip_invitations_ARj7Ut08RxVu_fkey";--> statement-breakpoint
DROP INDEX "trip_invitations_trip_waitlist_unique";--> statement-breakpoint
ALTER TABLE "trip_invitations" ALTER COLUMN "source" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "trip_invitation_source";--> statement-breakpoint
CREATE TYPE "trip_invitation_source" AS ENUM('date_request', 'direct');--> statement-breakpoint
ALTER TABLE "trip_invitations" ALTER COLUMN "source" SET DATA TYPE "trip_invitation_source" USING "source"::"trip_invitation_source";--> statement-breakpoint
ALTER TABLE "trip_invitations" DROP COLUMN "waitlist_entry_id";--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_source_reference_check" CHECK ((
        ("source" = 'date_request' and "course_inquiry_id" is not null and "person_id" is null)
        or ("source" = 'direct' and "course_inquiry_id" is null and "person_id" is not null)
      ));
