ALTER TYPE "capability_purpose" ADD VALUE 'bookkeeper_stop';--> statement-breakpoint
-- The schema stopped declaring shops.bookkeeper_stop_token_hash (#3721: the
-- month-end stop link is a bookkeeper_stop capability now). The
-- destructive-migration guard refuses its drop while main still declares it,
-- so drizzle's generated drop (column and unique index) is left out here and
-- follows next release. Nothing reads it any more; clear every stored hash.
UPDATE "shops" SET "bookkeeper_stop_token_hash" = NULL WHERE "bookkeeper_stop_token_hash" IS NOT NULL;--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_subject_by_purpose: replaced in the same statement by a check that admits every row the old one did and the new bookkeeper_stop purpose; the previous release writes only purposes the old check named
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_subject_by_purpose", ADD CONSTRAINT "capabilities_subject_by_purpose" CHECK (("purpose"::text in ('interest_unsubscribe') and "interest_id" is not null and "person_id" is null and "sent_to" is null)
        or ("purpose"::text in ('courtesy_email_unsubscribe', 'weekly_digest_unsubscribe') and "person_id" is not null and "interest_id" is null and "sent_to" is null)
        or ("purpose"::text in ('shore_alert_stop', 'bookkeeper_stop') and "sent_to" is not null and "sent_to" = lower("sent_to") and "person_id" is null and "interest_id" is null));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_used_only_when_spent: replaced in the same statement by a check that admits every row the old one did and a spent bookkeeper_stop; the previous release writes only purposes the old check named
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_used_only_when_spent", ADD CONSTRAINT "capabilities_used_only_when_spent" CHECK ("used_at" is null or "purpose"::text in ('shore_alert_stop', 'bookkeeper_stop'));