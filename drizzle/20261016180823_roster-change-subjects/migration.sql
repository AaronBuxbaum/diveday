-- Security review 2026-10-16, F1: every trail line that changes who is aboard
-- now names whose seat or crew place it was by record (`subject_person_id`),
-- so erasure reaches it by that and the departure log prints only such lines.
-- Lines written before carry the name alone. These statements give them their
-- subject where the trail itself proves it; a line they cannot pin to exactly
-- one person stays without one and the log leaves it out. DiveDay is pre-pilot
-- (H-20260815-no-legacy), so this runs over seed and demo rows: it exists so a demo departure's
-- log does not lose its late seat changes.
--
-- A seat line: the one person holding a seat on that departure under the name
-- the line wrote, either as booked (a held seat) or as on file. Not a
-- `seat_moved_away` line: that seat is on another departure now, so a person
-- of that name still on this one is somebody else (security re-review
-- 2026-10-16, item 3). It stays without a subject.
UPDATE "activity_events" AS "e"
SET "subject_person_id" = "m"."person_id"
FROM (
  SELECT "line"."id", (array_agg(DISTINCT "b"."person_id"))[1] AS "person_id"
  FROM "activity_events" AS "line"
  JOIN "bookings" AS "b" ON "b"."shop_id" = "line"."shop_id" AND "b"."trip_id" = "line"."trip_id"
  JOIN "people" AS "p" ON "p"."id" = "b"."person_id"
  WHERE "line"."subject_person_id" IS NULL
    AND "line"."code" IN (
      'seat_added', 'seat_added_walk_in', 'seat_added_from_trip_link', 'rider_added_at_dock',
      'booking_restored', 'booking_removed', 'party_seat_self_cancelled',
      'party_seat_self_refunded', 'seat_moved_here'
    )
    AND "line"."params"->>'diver' IN ("p"."full_name", btrim("b"."identity_booked_as"))
  GROUP BY "line"."id"
  HAVING count(DISTINCT "b"."person_id") = 1
) AS "m"
WHERE "e"."id" = "m"."id";--> statement-breakpoint
-- A diver's own cancel: the actor is the seat's diver.
UPDATE "activity_events"
SET "subject_person_id" = "actor_person_id"
WHERE "subject_person_id" IS NULL
  AND "code" IN ('seat_self_cancelled', 'seat_self_refunded');--> statement-breakpoint
-- A crew line: the one person at the shop with the name the line wrote.
UPDATE "activity_events" AS "e"
SET "subject_person_id" = "m"."person_id"
FROM (
  SELECT "line"."id", (array_agg(DISTINCT "p"."id"))[1] AS "person_id"
  FROM "activity_events" AS "line"
  JOIN "people" AS "p" ON "p"."shop_id" = "line"."shop_id" AND "p"."full_name" = "line"."params"->>'crew'
  WHERE "line"."subject_person_id" IS NULL
    AND "line"."code" IN ('crew_assigned', 'crew_removed')
  GROUP BY "line"."id"
  HAVING count(DISTINCT "p"."id") = 1
) AS "m"
WHERE "e"."id" = "m"."id";
