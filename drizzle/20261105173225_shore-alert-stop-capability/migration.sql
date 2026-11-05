ALTER TYPE "capability_purpose" ADD VALUE 'shore_alert_stop';--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "sent_to" text;--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "capabilities_sent_to_idx" ON "capabilities" ("shop_id","sent_to");--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_used_only_when_spent" CHECK ("used_at" is null or "purpose"::text in ('shore_alert_stop'));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_subject_by_purpose: replaced in the same statement by a check that admits every row the old one did (whose sent_to is null, as every row the previous release writes) and the new shop-address purpose
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_subject_by_purpose", ADD CONSTRAINT "capabilities_subject_by_purpose" CHECK (("purpose"::text in ('interest_unsubscribe') and "interest_id" is not null and "person_id" is null and "sent_to" is null)
        or ("purpose"::text in ('courtesy_email_unsubscribe', 'weekly_digest_unsubscribe') and "person_id" is not null and "interest_id" is null and "sent_to" is null)
        or ("purpose"::text in ('shore_alert_stop') and "sent_to" is not null and "sent_to" = lower("sent_to") and "person_id" is null and "interest_id" is null));--> statement-breakpoint
-- The shore contact's stop link is a shore_alert_stop capability now (#3721),
-- and nothing reads a stop row of shop_shore_alert_tokens any more. They are
-- deleted rather than copied across: pre-pilot, no users (H-20260815-no-legacy).
-- The 'stop' value the table's purpose check admits stays until the previous
-- release, which still writes it, is gone.
DELETE FROM "shop_shore_alert_tokens" WHERE "purpose" = 'stop';