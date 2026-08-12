ALTER TABLE "courses" ADD COLUMN "nitrox_compatible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Backfill the two shapes where a nitrox request could only ever mislead: a
-- taster session, and any course open to uncertified divers. Nobody enrolled
-- on either holds a nitrox card — the fill gate requires a verified one — and
-- their training dives are conducted on air, so the tick box would advertise
-- something the course cannot deliver. Every other course keeps the `true`
-- default and behaves exactly as it did before the column existed.
UPDATE "courses"
SET "nitrox_compatible" = false
WHERE "is_intro_course" = true OR "minimum_certification_level" IS NULL;
