ALTER TYPE "capability_purpose" ADD VALUE 'email_verification';--> statement-breakpoint
ALTER TYPE "capability_purpose" ADD VALUE 'password_reset';--> statement-breakpoint
ALTER TYPE "capability_purpose" ADD VALUE 'invite';--> statement-breakpoint
-- The account tokens are capabilities rows now (ADR 20261105-capabilities-shop-id-nullable).
-- Their rows are not copied: a new enum value cannot be used in the transaction that adds
-- it, and pre-pilot nobody needs them (H-20260815-no-legacy). A verify, reset or invite link
-- in flight stops working on deploy day; asking again mints a new one.
-- diveday:allow-destructive drop-table account_tokens: moved onto capabilities (#3721, ADR 20261105-capabilities-shop-id-nullable); pre-pilot, no users, H-20260815-no-legacy; a link in flight dies and is asked for again
DROP TABLE "account_tokens";--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "user_account_id" uuid;--> statement-breakpoint
ALTER TABLE "capabilities" ALTER COLUMN "shop_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "capabilities_user_account_idx" ON "capabilities" ("user_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capabilities_live_account_purpose_idx" ON "capabilities" ("user_account_id","purpose") WHERE "user_account_id" is not null and "used_at" is null and "revoked_at" is null;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_user_account_id_user_accounts_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id");--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_scope_by_purpose" CHECK (("shop_id" is null) = ("purpose"::text in ('email_verification', 'password_reset', 'invite')));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_subject_by_purpose: replaced in the same statement by a check that admits every row the old one did and the account-token purposes; the previous release writes only purposes the old check named
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_subject_by_purpose", ADD CONSTRAINT "capabilities_subject_by_purpose" CHECK (("purpose"::text in ('interest_unsubscribe') and "interest_id" is not null and "person_id" is null and "sent_to" is null and "user_account_id" is null)
        or ("purpose"::text in ('courtesy_email_unsubscribe', 'weekly_digest_unsubscribe') and "person_id" is not null and "interest_id" is null and "sent_to" is null and "user_account_id" is null)
        or ("purpose"::text in ('shore_alert_stop', 'bookkeeper_stop', 'shore_alert_confirm') and "sent_to" is not null and "sent_to" = lower("sent_to") and "person_id" is null and "interest_id" is null and "user_account_id" is null)
        or ("purpose"::text in ('email_verification', 'password_reset', 'invite') and "user_account_id" is not null and "person_id" is null and "interest_id" is null and "sent_to" is null));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_used_only_when_spent: replaced in the same statement by a check that admits every row the old one did and a spent account token
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_used_only_when_spent", ADD CONSTRAINT "capabilities_used_only_when_spent" CHECK ("used_at" is null or "purpose"::text in ('shore_alert_stop', 'bookkeeper_stop', 'shore_alert_confirm', 'email_verification', 'password_reset', 'invite'));--> statement-breakpoint
-- diveday:allow-destructive drop-constraint capabilities.capabilities_expiry_by_purpose: replaced in the same statement by a check that admits every row the old one did and the account tokens' deadlines
ALTER TABLE "capabilities" DROP CONSTRAINT "capabilities_expiry_by_purpose", ADD CONSTRAINT "capabilities_expiry_by_purpose" CHECK (("expires_at" is not null) = ("purpose"::text in ('shore_alert_confirm', 'email_verification', 'password_reset', 'invite')));--> statement-breakpoint
-- diveday:allow-destructive drop-type account_token_purpose: only account_tokens used it, dropped above; pre-pilot, H-20260815-no-legacy
DROP TYPE "account_token_purpose";