-- Booking links are derived from their row (ADR 20261104-derived-booking-link-tokens).
-- The previous release stopped declaring these columns and cleared them; drop them now (#3901).
-- diveday:allow-destructive drop-column booking_capabilities.token_hash: booking links are derived from their row (#2711); no schema declares it since #3901's first half and the previous release cleared it; pre-pilot, no users (H-20260815-no-legacy) (issue #3901)
ALTER TABLE "booking_capabilities" DROP COLUMN "token_hash";--> statement-breakpoint
-- diveday:allow-destructive drop-column booking_capabilities.token_sealed: booking links are derived from their row (#2711); no schema declares it since #3901's first half and the previous release cleared it; pre-pilot, no users (H-20260815-no-legacy) (issue #3901)
ALTER TABLE "booking_capabilities" DROP COLUMN "token_sealed";
