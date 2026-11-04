-- Issue #2702 (ADR 20261104-arrival-is-a-trail): `bookings.status` stops mirroring the arrival trail.
-- A `checked_in` seat is a held seat, so it becomes `booked`; the desk's sighting already stands in
-- `booking_arrival_events`, which every live and offline check-in has written since ADR
-- 20260907-the-counter-survives-offline. The next migration drops the enum value, and its type
-- change refuses any row still carrying it.
UPDATE "bookings" SET "status" = 'booked' WHERE "status" = 'checked_in';
--> statement-breakpoint
-- The one check that names a `booking_status` value; it cannot survive the type being recreated, so
-- it is dropped here and added back, unchanged, two migrations on.
-- diveday:allow-destructive drop-constraint bookings.bookings_turned_away_is_released: re-added unchanged two migrations on, inside the same deploy; the previous release writes nothing it forbids
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_turned_away_is_released";
