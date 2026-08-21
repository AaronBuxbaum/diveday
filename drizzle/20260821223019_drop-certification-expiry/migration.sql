-- A recreational certification does not expire, and neither PADI nor SSI
-- mandates a refresher, so this column modelled a rule that does not exist and
-- gated boarding on it (issue #630, ADR 20260821-a-card-does-not-expire,
-- superseding 20260723-certification-expiry-date-only). What keeps a diver
-- current is when they last dived, which lives on bookings.last_dived_band and
-- is untouched. So is waiver_records.expires_at: a waiver really does lapse.
-- diveday:allow-destructive drop-column certifications.expires_at: pre-pilot, no users, H-49
ALTER TABLE "certifications" DROP COLUMN "expires_at";--> statement-breakpoint
-- diveday:allow-destructive drop-column specialty_certifications.expires_at: pre-pilot, no users, H-49
ALTER TABLE "specialty_certifications" DROP COLUMN "expires_at";
