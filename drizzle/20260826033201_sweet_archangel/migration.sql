ALTER TABLE "booking_checkout_bookings" ADD COLUMN "tax_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "tax_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "tax_cents" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "tax_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- diveday:allow-destructive alter-column-type gear_items.kind.text: temporarily widen the enum so legacy combined rows can be split without losing their reservations
ALTER TABLE "gear_items" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
CREATE TEMP TABLE "legacy_mask_fins" ON COMMIT DROP AS
SELECT "id", "shop_id", "label", "size", "serial_number", "brand_model", "purchased_on", "status", "service_note", "deleted_at", "deleted_by_person_id", "created_at", "updated_at"
FROM "gear_items"
WHERE "kind" = 'mask_fins';--> statement-breakpoint
UPDATE "gear_items"
SET "kind" = 'fins'
WHERE "kind" = 'mask_fins';--> statement-breakpoint
INSERT INTO "gear_items" ("id", "shop_id", "kind", "label", "size", "serial_number", "brand_model", "purchased_on", "status", "service_note", "deleted_at", "deleted_by_person_id", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  "legacy_mask_fins"."shop_id",
  'mask',
  "legacy_mask_fins"."label" || ' (mask ' || "legacy_mask_fins"."id"::text || ')',
  NULL,
  NULL,
  "legacy_mask_fins"."brand_model",
  "legacy_mask_fins"."purchased_on",
  "legacy_mask_fins"."status",
  "legacy_mask_fins"."service_note",
  "legacy_mask_fins"."deleted_at",
  "legacy_mask_fins"."deleted_by_person_id",
  "legacy_mask_fins"."created_at",
  "legacy_mask_fins"."updated_at"
FROM "legacy_mask_fins";--> statement-breakpoint
-- diveday:allow-destructive drop-type gear_item_kind: replace the legacy combined register kind after preserving its rows as physical fins and mask units
DROP TYPE "gear_item_kind";--> statement-breakpoint
CREATE TYPE "gear_item_kind" AS ENUM('bcd', 'regulator', 'wetsuit', 'boots', 'mask', 'fins', 'weights', 'dive_computer', 'gopro', 'tank', 'drysuit', 'hood', 'gloves', 'torch', 'dpv', 'smb', 'reel', 'camera', 'nitrox_analyzer', 'o2_kit', 'other');--> statement-breakpoint
-- diveday:allow-destructive alter-column-type gear_items.kind.gear_item_kind: restore the narrowed physical-unit enum after the legacy rows are split
ALTER TABLE "gear_items" ALTER COLUMN "kind" SET DATA TYPE "gear_item_kind" USING "kind"::"gear_item_kind";--> statement-breakpoint
ALTER TABLE "booking_checkout_bookings" ADD CONSTRAINT "booking_checkout_bookings_tax_cents_nonnegative" CHECK ("tax_cents" >= 0);--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_tax_nonnegative" CHECK ("tax_cents" is null or "tax_cents" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tax_nonnegative" CHECK ("tax_cents" >= 0);
