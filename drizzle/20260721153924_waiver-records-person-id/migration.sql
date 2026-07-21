-- Add the person the release belongs to. Backfilled from the booking so a
-- completed waiver becomes queryable per diver (sign-once carry-forward), then
-- locked NOT NULL to match the schema. Fresh installs add the column to an empty
-- table; the backfill only matters where waiver records already exist.
ALTER TABLE "waiver_records" ADD COLUMN "person_id" uuid;--> statement-breakpoint
UPDATE "waiver_records" AS "wr" SET "person_id" = "b"."person_id" FROM "bookings" AS "b" WHERE "b"."id" = "wr"."booking_id";--> statement-breakpoint
ALTER TABLE "waiver_records" ALTER COLUMN "person_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "waiver_records_shop_person_status_idx" ON "waiver_records" ("shop_id","person_id","status");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");
