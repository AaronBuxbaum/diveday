ALTER TABLE "people" ADD COLUMN "created_by_booking_id" uuid;--> statement-breakpoint
-- Issue #2665, decided by Aaron 2026-10-17: stamp a person who existed before
-- this column only where their one booking (under any status) was made in the
-- same moment they were, which is how a name-only seat inserts both rows: the
-- person first, then the seat, a moment apart on the app clock. Everyone else
-- stays unstamped, and the parent's door stays closed for them (staff can still
-- record the release at the counter).
UPDATE "people" AS "p"
SET "created_by_booking_id" = "b"."id"
FROM "bookings" AS "b"
WHERE "b"."person_id" = "p"."id"
  AND "b"."shop_id" = "p"."shop_id"
  AND "p"."created_by_booking_id" IS NULL
  -- A name-only seat's person has no address; one with an address was not
  -- made by a seat alone (security review 2026-10-17).
  AND "p"."email" IS NULL
  AND "b"."created_at" >= "p"."created_at"
  AND "b"."created_at" < "p"."created_at" + interval '1 second'
  AND (SELECT count(*) FROM "bookings" AS "o" WHERE "o"."person_id" = "p"."id") = 1;
