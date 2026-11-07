-- diveday:allow-destructive drop-column bookings.identity_matched_by: a held seat has one way in, the counter's name prompt, and `identity_booked_as` says all the column did (#4113); the previous release stopped declaring it and nothing reads it; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-type identity_match_kind: only bookings.identity_matched_by used the type, dropped just above, and the previous release no longer declares it (#4113)
ALTER TABLE "bookings" DROP COLUMN "identity_matched_by";--> statement-breakpoint
DROP TYPE "identity_match_kind";
