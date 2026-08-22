-- The card number a diver typed about themselves, kept out of `identifier` —
-- which is a key, and a key a stranger can write is a failed sale, an existence
-- oracle, and a way to take the card-entry form away from the real diver
-- (`security-reviewer`, issue #630). See the column's note in src/db/schema.ts.
ALTER TABLE "certifications" ADD COLUMN "declared_identifier" text;--> statement-breakpoint

-- A site or trip may no longer require a professional rating of a paying diver
-- (issue #630), and the two form parses now refuse one. A row still holding
-- `divemaster`/`instructor` would match no option in its own `<select>`, so the
-- browser would select the first — "No level required" — and the next unrelated
-- save would silently drop the departure's cert gate to nothing
-- (`dive-domain-expert`). Normalised down to the top requirable rung instead:
-- fail-safe rather than fail-open, and the shop can still lower it by hand.
-- Neither statement is destructive — the column and its type are untouched, and
-- both tables are empty of these values today (checked against every seed, the
-- course templates and the site catalog).
UPDATE "dive_sites"
SET "minimum_certification_level" = 'rescue'
WHERE "minimum_certification_level" IN ('divemaster', 'instructor');--> statement-breakpoint
UPDATE "trip_requirements"
SET "minimum_certification_level" = 'rescue'
WHERE "minimum_certification_level" IN ('divemaster', 'instructor');
