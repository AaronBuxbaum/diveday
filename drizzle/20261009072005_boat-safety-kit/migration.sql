ALTER TYPE "gear_item_kind" ADD VALUE 'aed' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "gear_item_kind" ADD VALUE 'first_aid_kit' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "gear_item_kind" ADD VALUE 'flares' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "gear_service_kind" ADD VALUE 'aed_pads' BEFORE 'note';--> statement-breakpoint
ALTER TYPE "gear_service_kind" ADD VALUE 'aed_battery' BEFORE 'note';--> statement-breakpoint
ALTER TYPE "gear_service_kind" ADD VALUE 'expiry' BEFORE 'note';--> statement-breakpoint
ALTER TABLE "gear_items" ADD COLUMN "aboard_boat_id" uuid;--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "certified_passengers" integer;--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "inspection_due_on" date;--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "registration_expires_on" date;--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "insurance_expires_on" date;--> statement-breakpoint
CREATE INDEX "gear_items_aboard_boat_idx" ON "gear_items" ("aboard_boat_id") WHERE "aboard_boat_id" is not null and "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_aboard_boat_id_boats_id_fkey" FOREIGN KEY ("aboard_boat_id") REFERENCES "boats"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "boats" ADD CONSTRAINT "boats_certified_passengers_positive" CHECK ("certified_passengers" is null or "certified_passengers" between 1 and 999);