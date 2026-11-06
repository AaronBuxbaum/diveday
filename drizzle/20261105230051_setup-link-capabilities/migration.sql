ALTER TYPE "capability_purpose" ADD VALUE 'shop_setup';--> statement-breakpoint
-- Setup links are shop_setup capabilities now (ADR 20261105-capabilities-shop-id-nullable).
-- Their rows are not copied (a new enum value cannot be used in the transaction that adds it);
-- pre-pilot, an unspent link in flight dies and the founder mints another (H-20260815-no-legacy).
-- diveday:allow-destructive drop-table shop_setup_links: moved onto capabilities (#3721, ADR 20261105-capabilities-shop-id-nullable); pre-pilot, no users, H-20260815-no-legacy; an unspent link in flight dies
DROP TABLE "shop_setup_links";--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "setup_request_id" uuid;--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "spent_by_shop_id" uuid;--> statement-breakpoint
CREATE INDEX "capabilities_setup_request_idx" ON "capabilities" ("setup_request_id");--> statement-breakpoint
CREATE INDEX "capabilities_spent_by_shop_idx" ON "capabilities" ("spent_by_shop_id");--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_setup_request_id_setup_requests_id_fkey" FOREIGN KEY ("setup_request_id") REFERENCES "setup_requests"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_spent_by_shop_id_shops_id_fkey" FOREIGN KEY ("spent_by_shop_id") REFERENCES "shops"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_spent_by_shop_only_setup" CHECK ("spent_by_shop_id" is null or "purpose"::text in ('shop_setup'));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_subject_by_purpose: replaced in the same statement by a check that admits every row the old one did and the shop_setup purpose; the previous release writes only purposes the old check named
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_subject_by_purpose", ADD CONSTRAINT "capabilities_subject_by_purpose" CHECK (("purpose"::text in ('interest_unsubscribe') and "interest_id" is not null and "person_id" is null and "sent_to" is null and "user_account_id" is null and "setup_request_id" is null)
        or ("purpose"::text in ('courtesy_email_unsubscribe', 'weekly_digest_unsubscribe') and "person_id" is not null and "interest_id" is null and "sent_to" is null and "user_account_id" is null and "setup_request_id" is null)
        or ("purpose"::text in ('shore_alert_stop', 'bookkeeper_stop', 'shore_alert_confirm') and "sent_to" is not null and "sent_to" = lower("sent_to") and "person_id" is null and "interest_id" is null and "user_account_id" is null and "setup_request_id" is null)
        or ("purpose"::text in ('email_verification', 'password_reset', 'invite') and "user_account_id" is not null and "person_id" is null and "interest_id" is null and "sent_to" is null and "setup_request_id" is null)
        or ("purpose"::text in ('shop_setup') and "setup_request_id" is not null and "person_id" is null and "interest_id" is null and "sent_to" is null and "user_account_id" is null));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_used_only_when_spent: replaced in the same statement by a check that admits every row the old one did and a spent setup link; the previous release writes only purposes the old check named
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_used_only_when_spent", ADD CONSTRAINT "capabilities_used_only_when_spent" CHECK ("used_at" is null or "purpose"::text in ('shore_alert_stop', 'bookkeeper_stop', 'shore_alert_confirm', 'email_verification', 'password_reset', 'invite', 'shop_setup'));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_expiry_by_purpose: replaced in the same statement by a check that admits every row the old one did and the setup link's deadline; the previous release writes only purposes the old check named
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_expiry_by_purpose", ADD CONSTRAINT "capabilities_expiry_by_purpose" CHECK (("expires_at" is not null) = ("purpose"::text in ('shore_alert_confirm', 'email_verification', 'password_reset', 'invite', 'shop_setup')));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_scope_by_purpose: replaced in the same statement by a check that admits every row the old one did and the platform shop_setup purpose; the previous release writes only purposes the old check named
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_scope_by_purpose", ADD CONSTRAINT "capabilities_scope_by_purpose" CHECK (("shop_id" is null) = ("purpose"::text in ('email_verification', 'password_reset', 'invite', 'shop_setup')));