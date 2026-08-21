ALTER TABLE "gear_items" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gear_items" ADD COLUMN "deleted_by_person_id" uuid;--> statement-breakpoint
-- Hand-added, and it must run before the enum loses the value: a unit a shop
-- had "retired" is a unit it was finished with, which under ADR
-- 20260820-every-delete-is-soft is a delete. The row and its service and
-- rental history stay exactly where they are either way.
UPDATE "gear_items" SET "deleted_at" = now() WHERE "status" = 'retired';--> statement-breakpoint
UPDATE "gear_items" SET "status" = 'in_service' WHERE "status" = 'retired';--> statement-breakpoint
-- diveday:allow-destructive alter-column-type gear_items.status: same enum minus 'retired', whose rows the two UPDATEs above have already moved to deleted; pre-pilot, no users (H-49)
ALTER TABLE "gear_items" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
-- diveday:allow-destructive drop-default gear_items.status: re-set to 'in_service' four statements below, inside this same migration; pre-pilot, no users (H-49)
ALTER TABLE "gear_items" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
-- diveday:allow-destructive drop-type gear_item_status: recreated on the next line without 'retired'; no row and no code in this release carries that value; pre-pilot, no users (H-49)
DROP TYPE "gear_item_status";--> statement-breakpoint
CREATE TYPE "gear_item_status" AS ENUM('in_service', 'needs_service');--> statement-breakpoint
ALTER TABLE "gear_items" ALTER COLUMN "status" SET DATA TYPE "gear_item_status" USING "status"::"gear_item_status";--> statement-breakpoint
ALTER TABLE "gear_items" ALTER COLUMN "status" SET DEFAULT 'in_service'::"gear_item_status";--> statement-breakpoint
DROP INDEX "gear_items_shop_label_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "gear_items_shop_label_unique" ON "gear_items" ("shop_id","label") WHERE "deleted_at" is null;--> statement-breakpoint
DROP INDEX "gear_items_shop_kind_idx";--> statement-breakpoint
CREATE INDEX "gear_items_shop_kind_idx" ON "gear_items" ("shop_id","kind") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");
