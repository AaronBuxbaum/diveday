ALTER TYPE "capability_purpose" ADD VALUE 'calendar_assignments';--> statement-breakpoint
ALTER TYPE "capability_purpose" ADD VALUE 'calendar_shop_trips';--> statement-breakpoint
-- Staff calendar feeds are calendar_assignments / calendar_shop_trips capabilities now
-- (ADR 20261105-capabilities-shop-id-nullable). Their rows are not copied (a new enum value
-- cannot be used in the transaction that adds it); pre-pilot, a subscribed calendar stops
-- updating and the staffer subscribes again from Me > Calendar (H-20260815-no-legacy).
-- diveday:allow-destructive drop-table calendar_feeds: moved onto capabilities (#3721, ADR 20261105-capabilities-shop-id-nullable); pre-pilot, no users, H-20260815-no-legacy; a subscribed feed stops and is issued again
DROP TABLE "calendar_feeds";--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "last_accessed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "one_live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "capabilities_live_person_purpose_idx" ON "capabilities" ("person_id","purpose") WHERE "one_live" and "used_at" is null and "revoked_at" is null;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_one_live_by_purpose" CHECK ("one_live" = ("purpose"::text in ('calendar_assignments', 'calendar_shop_trips')));--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_accessed_only_when_reusable" CHECK ("last_accessed_at" is null or "purpose"::text in ('calendar_assignments', 'calendar_shop_trips'));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_subject_by_purpose: replaced in the same statement by a check that admits every row the old one did and the two calendar feed purposes; the previous release writes only purposes the old check named
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_subject_by_purpose", ADD CONSTRAINT "capabilities_subject_by_purpose" CHECK (("purpose"::text in ('interest_unsubscribe') and "interest_id" is not null and "person_id" is null and "sent_to" is null and "user_account_id" is null and "setup_request_id" is null)
        or ("purpose"::text in ('courtesy_email_unsubscribe', 'weekly_digest_unsubscribe', 'calendar_assignments', 'calendar_shop_trips') and "person_id" is not null and "interest_id" is null and "sent_to" is null and "user_account_id" is null and "setup_request_id" is null)
        or ("purpose"::text in ('shore_alert_stop', 'bookkeeper_stop', 'shore_alert_confirm') and "sent_to" is not null and "sent_to" = lower("sent_to") and "person_id" is null and "interest_id" is null and "user_account_id" is null and "setup_request_id" is null)
        or ("purpose"::text in ('email_verification', 'password_reset', 'invite') and "user_account_id" is not null and "person_id" is null and "interest_id" is null and "sent_to" is null and "setup_request_id" is null)
        or ("purpose"::text in ('shop_setup') and "setup_request_id" is not null and "person_id" is null and "interest_id" is null and "sent_to" is null and "user_account_id" is null));--> statement-breakpoint
-- diveday:allow-destructive drop-type calendar_feed_scope: only calendar_feeds used it, dropped above; pre-pilot, H-20260815-no-legacy
DROP TYPE "calendar_feed_scope";