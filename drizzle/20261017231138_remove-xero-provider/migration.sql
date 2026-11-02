-- diveday:allow-destructive alter-column-type integration_oauth_states.provider: Xero connector removed before launch (#2818), pre-pilot, no users (H-20260815-no-legacy); pre-pilot, no tenant has a xero row (H-20260815-no-legacy); a Xero connect attempt during the deploy window fails the migration or 500s, and both outcomes are acceptable
ALTER TABLE "integration_oauth_states" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
-- diveday:allow-destructive alter-column-type integration_sync_records.provider: Xero connector removed before launch (#2818), pre-pilot, no users (H-20260815-no-legacy); pre-pilot, no tenant has a xero row (H-20260815-no-legacy); a Xero connect attempt during the deploy window fails the migration or 500s, and both outcomes are acceptable
ALTER TABLE "integration_sync_records" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
-- diveday:allow-destructive alter-column-type shop_integrations.provider: Xero connector removed before launch (#2818), pre-pilot, no users (H-20260815-no-legacy); pre-pilot, no tenant has a xero row (H-20260815-no-legacy); a Xero connect attempt during the deploy window fails the migration or 500s, and both outcomes are acceptable
ALTER TABLE "shop_integrations" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
DELETE FROM "integration_oauth_states" WHERE "provider" = 'xero';--> statement-breakpoint
DELETE FROM "integration_sync_records" WHERE "provider" = 'xero';--> statement-breakpoint
DELETE FROM "shop_integrations" WHERE "provider" = 'xero';--> statement-breakpoint
-- diveday:allow-destructive drop-type integration_provider: Xero connector removed before launch (#2818), pre-pilot, no users (H-20260815-no-legacy); pre-pilot, no tenant has a xero row (H-20260815-no-legacy); a Xero connect attempt during the deploy window fails the migration or 500s, and both outcomes are acceptable
DROP TYPE "integration_provider";--> statement-breakpoint
CREATE TYPE "integration_provider" AS ENUM('shopify', 'quickbooks', 'zapier');--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ALTER COLUMN "provider" SET DATA TYPE "integration_provider" USING "provider"::"integration_provider";--> statement-breakpoint
ALTER TABLE "integration_sync_records" ALTER COLUMN "provider" SET DATA TYPE "integration_provider" USING "provider"::"integration_provider";--> statement-breakpoint
ALTER TABLE "shop_integrations" ALTER COLUMN "provider" SET DATA TYPE "integration_provider" USING "provider"::"integration_provider";