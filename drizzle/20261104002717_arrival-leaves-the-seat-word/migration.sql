-- Issue #2702 (ADR 20261104-arrival-is-a-trail): `bookings.status` stops mirroring the arrival trail.
-- A `checked_in` seat is a held seat, so it becomes `booked`; the desk's sighting already stands in
-- `booking_arrival_events`, which every live and offline check-in has written since ADR
-- 20260907-the-counter-survives-offline. A check-in older than that trail has no row there and
-- reads as plain `booked` from now on; those seats are on departures that sailed in September, and
-- no row can be written for them because the trail needs the staffer who saw the diver. The next
-- migration drops the enum value, and its type change refuses any row still carrying it.
-- Before that rewrite, while `booked` still means "not seen at the desk": a `booked` seat whose
-- trail still ends in `arrived` came back from an earlier life (Remove undone, a cancelled row booked
-- again, a move away and back), and that arrival is not today's. Their high-water `seq` is held here
-- and written to `bookings.arrival_trail_after_seq` once that column exists, three migrations on.
CREATE TABLE "arrival_trail_backfill" ("booking_id" uuid PRIMARY KEY, "after_seq" bigint NOT NULL);
--> statement-breakpoint
INSERT INTO "arrival_trail_backfill" ("booking_id", "after_seq")
SELECT b."id", (SELECT max(e."seq") FROM "booking_arrival_events" e WHERE e."booking_id" = b."id")
FROM "bookings" b
WHERE b."status" = 'booked'
  AND (
    SELECT e."status" FROM "booking_arrival_events" e
    WHERE e."shop_id" = b."shop_id" AND e."trip_id" = b."trip_id" AND e."booking_id" = b."id"
    ORDER BY e."occurred_at" DESC, e."created_at" DESC, e."seq" DESC
    LIMIT 1
  ) = 'arrived';
--> statement-breakpoint
UPDATE "bookings" SET "status" = 'booked' WHERE "status" = 'checked_in';
--> statement-breakpoint
-- The one check that names a `booking_status` value; it cannot survive the type being recreated, so
-- it is dropped here and added back, unchanged, two migrations on.
-- diveday:allow-destructive drop-constraint bookings.bookings_turned_away_is_released: re-added unchanged two migrations on, inside the same deploy; the previous release writes nothing it forbids
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_turned_away_is_released";
