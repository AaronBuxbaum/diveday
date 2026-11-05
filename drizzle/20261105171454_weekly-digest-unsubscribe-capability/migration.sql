ALTER TYPE "capability_purpose" ADD VALUE 'weekly_digest_unsubscribe';--> statement-breakpoint
-- The schema stopped declaring weekly_digest_sends.unsubscribe_token_hash
-- (#3721: the Monday email's opt-out link is a capability now). The
-- destructive-migration guard refuses its drop while main still declares it,
-- so drizzle's generated drop (column and unique key) is left out here and follows next release. The
-- new sender writes no hash, so the column stops being required, and every
-- stored hash is cleared: none of them opens anything any more.
ALTER TABLE "weekly_digest_sends" ALTER COLUMN "unsubscribe_token_hash" DROP NOT NULL;--> statement-breakpoint
UPDATE "weekly_digest_sends" SET "unsubscribe_token_hash" = NULL WHERE "unsubscribe_token_hash" IS NOT NULL;--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_subject_by_purpose: replaced in the same statement by a check that admits every row the old one did and one new person purpose; the previous release writes only the two purposes the old check named
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_subject_by_purpose", ADD CONSTRAINT "capabilities_subject_by_purpose" CHECK (("purpose"::text in ('interest_unsubscribe') and "interest_id" is not null and "person_id" is null)
        or ("purpose"::text in ('courtesy_email_unsubscribe', 'weekly_digest_unsubscribe') and "person_id" is not null and "interest_id" is null));