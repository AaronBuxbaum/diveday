-- Issue #1015. `integration_sync_records` moves off `integration_id` and onto
-- `(shop_id, provider)`, so the QuickBooks idempotency map outlives any one
-- connection; `shop_integrations` gains `deleted_at` so a disconnect stamps
-- rather than deletes, and its uniqueness becomes partial over live rows so a
-- reconnect can insert beside the stamped one.
--
-- Both destructive statements are on `integration_sync_records`, a table with no
-- rows anywhere: the connectors shipped 2026-08-25, DiveDay is pre-pilot (H-49),
-- and neither provider renders at all without `SHOPIFY_CLIENT_ID` /
-- `QUICKBOOKS_CLIENT_ID`, which no deployment sets. The only code that reads the
-- dropped column is the 10-minute integrations cron and the on-demand Shopify
-- catalog push; with no connected integration there is nothing for either to
-- read, and the worst case if one somehow ran mid-build is a single failed cron
-- pass that the next one repeats.
-- diveday:allow-destructive drop-constraint integration_sync_records.integration_sync_records_vVIWgqTqpGfj_fkey: this is the foreign key of the column being replaced; no rows exist and no live deployment has a connected integration (pre-pilot, H-49)
-- diveday:allow-destructive drop-column integration_sync_records.integration_id: replaced by (shop_id, provider) in the same statement block; no rows exist and no live deployment has a connected integration (pre-pilot, H-49)
--
-- Statement order is hand-corrected, and only the order: `DROP COLUMN
-- integration_id` takes both of that table's indexes with it, so the generator's
-- `DROP INDEX` after it raised 42704 and the migration could not run at all.
-- The set of statements, and the end state the snapshot describes, are the
-- generator's own.
ALTER TABLE "integration_sync_records" DROP CONSTRAINT "integration_sync_records_vVIWgqTqpGfj_fkey";--> statement-breakpoint
DROP INDEX "integration_sync_records_source_unique";--> statement-breakpoint
DROP INDEX "integration_sync_records_external_idx";--> statement-breakpoint
ALTER TABLE "integration_sync_records" DROP COLUMN "integration_id";--> statement-breakpoint
ALTER TABLE "integration_sync_records" ADD COLUMN "shop_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_sync_records" ADD COLUMN "provider" "integration_provider" NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_sync_records" ADD CONSTRAINT "integration_sync_records_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_records_source_unique" ON "integration_sync_records" ("shop_id","provider","source_type","source_id","operation");--> statement-breakpoint
CREATE INDEX "integration_sync_records_external_idx" ON "integration_sync_records" ("shop_id","provider","external_id");--> statement-breakpoint
ALTER TABLE "shop_integrations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX "shop_integrations_shop_provider_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "shop_integrations_shop_provider_unique" ON "shop_integrations" ("shop_id","provider") WHERE "deleted_at" is null;
