ALTER TABLE "rental_gear_profiles" RENAME TO "rental_fit_profiles";--> statement-breakpoint
ALTER TABLE "gear_assignments" DROP CONSTRAINT "gear_assignments_gear_item_id_gear_items_id_fk";--> statement-breakpoint
ALTER TABLE "gear_service_events" DROP CONSTRAINT "gear_service_events_gear_item_id_gear_items_id_fk";--> statement-breakpoint
ALTER TABLE "nitrox_fills" DROP CONSTRAINT "nitrox_fills_gear_item_id_gear_items_id_fk";--> statement-breakpoint
DROP TABLE "gear_assignments";--> statement-breakpoint
DROP TABLE "gear_items";--> statement-breakpoint
DROP TABLE "gear_service_events";--> statement-breakpoint
DROP TABLE "nitrox_fills";--> statement-breakpoint
DROP TABLE "rental_gear_requests";--> statement-breakpoint
ALTER INDEX "rental_gear_profiles_shop_person_unique" RENAME TO "rental_fit_profiles_shop_person_unique";--> statement-breakpoint
ALTER INDEX "rental_gear_profiles_shop_person_idx" RENAME TO "rental_fit_profiles_shop_person_idx";--> statement-breakpoint
DROP INDEX "waiver_templates_shop_default_idx";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "wants_nitrox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "rents_bcd" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "rents_regulator" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "rents_wetsuit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "rents_mask_fins" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "rents_weights" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_fit_profiles" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "order_line_items" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "order_line_items" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
UPDATE "order_line_items" SET "kind" = 'rental' WHERE "kind" = 'rental_gear';--> statement-breakpoint
DROP TYPE "order_line_item_kind";--> statement-breakpoint
CREATE TYPE "order_line_item_kind" AS ENUM('trip_fee', 'course_fee', 'e_learning_fee', 'rental', 'nitrox', 'deposit', 'merchandise', 'other');--> statement-breakpoint
ALTER TABLE "order_line_items" ALTER COLUMN "kind" SET DATA TYPE "order_line_item_kind" USING "kind"::"order_line_item_kind";--> statement-breakpoint
ALTER TABLE "order_line_items" ALTER COLUMN "kind" SET DEFAULT 'other'::"order_line_item_kind";--> statement-breakpoint
ALTER TABLE "waiver_templates" DROP COLUMN "is_default";--> statement-breakpoint
DROP TYPE "gear_assignment_status";--> statement-breakpoint
DROP TYPE "gear_state";--> statement-breakpoint
DROP TYPE "gear_type";