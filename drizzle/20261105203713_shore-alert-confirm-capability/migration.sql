ALTER TYPE "capability_purpose" ADD VALUE 'shore_alert_confirm';--> statement-breakpoint
-- The schema stopped declaring shop_shore_alert_tokens (#3721: the shore
-- contact's confirm link is a shore_alert_confirm capability now). The previous
-- release still reads and writes it while this deploy is in flight, so
-- drizzle's generated DROP TABLE is left out here and follows next release.
-- Nothing reads it any more; delete its rows, which hold the address, now.
-- Copying live links across is not possible (a new enum value cannot be used
-- in the transaction that adds it), and pre-pilot nobody needs them
-- (H-20260815-no-legacy): a pending confirm link stops working on deploy day.
DELETE FROM "shop_shore_alert_tokens" WHERE "purpose" IN ('confirm', 'stop');--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_expiry_by_purpose" CHECK (("expires_at" is not null) = ("purpose"::text in ('shore_alert_confirm')));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_subject_by_purpose: replaced in the same statement by a check that admits every row the old one did and the new shore_alert_confirm purpose; the previous release writes only purposes the old check named
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_subject_by_purpose", ADD CONSTRAINT "capabilities_subject_by_purpose" CHECK (("purpose"::text in ('interest_unsubscribe') and "interest_id" is not null and "person_id" is null and "sent_to" is null)
        or ("purpose"::text in ('courtesy_email_unsubscribe', 'weekly_digest_unsubscribe') and "person_id" is not null and "interest_id" is null and "sent_to" is null)
        or ("purpose"::text in ('shore_alert_stop', 'bookkeeper_stop', 'shore_alert_confirm') and "sent_to" is not null and "sent_to" = lower("sent_to") and "person_id" is null and "interest_id" is null));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_used_only_when_spent: replaced in the same statement by a check that admits every row the old one did and a spent shore_alert_confirm; the previous release writes only purposes the old check named
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_used_only_when_spent", ADD CONSTRAINT "capabilities_used_only_when_spent" CHECK ("used_at" is null or "purpose"::text in ('shore_alert_stop', 'bookkeeper_stop', 'shore_alert_confirm'));