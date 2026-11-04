ALTER TABLE "bookings" ADD COLUMN "arrival_trail_after_seq" bigint;
--> statement-breakpoint
-- The seats held aside before `checked_in` was folded into `booked` (20261104002717): each starts its
-- trail after the arrival from its earlier life.
UPDATE "bookings" b SET "arrival_trail_after_seq" = f."after_seq"
FROM "arrival_trail_backfill" f
WHERE f."booking_id" = b."id";
--> statement-breakpoint
-- diveday:allow-destructive drop-table arrival_trail_backfill: a holding table this deploy created two migrations back, read just above
DROP TABLE "arrival_trail_backfill";
