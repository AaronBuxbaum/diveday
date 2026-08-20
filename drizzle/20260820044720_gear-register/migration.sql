-- ADR 20260815-minimal-gear-register: btree_gist supplies the gist opclass
-- for `uuid =` so the EXCLUDE constraint at the bottom of this file can pair
-- it with a daterange overlap check. Standard Postgres contrib extension —
-- available on Neon and loaded explicitly for PGlite (see src/db/client.ts,
-- same pattern as pg_trgm in 20260724001031_trigram-search-indexes).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "gear_item_kind" AS ENUM('bcd', 'regulator', 'wetsuit', 'boots', 'mask_fins', 'weights', 'dive_computer', 'gopro', 'tank', 'other');--> statement-breakpoint
CREATE TYPE "gear_item_status" AS ENUM('in_service', 'needs_service', 'retired');--> statement-breakpoint
CREATE TYPE "gear_service_kind" AS ENUM('service', 'hydro_test', 'visual_inspection', 'o2_clean', 'note');--> statement-breakpoint
CREATE TABLE "gear_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"kind" "gear_item_kind" NOT NULL,
	"label" text NOT NULL,
	"size" text,
	"serial_number" text,
	"brand_model" text,
	"purchased_on" date,
	"status" "gear_item_status" DEFAULT 'in_service'::"gear_item_status" NOT NULL,
	"service_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gear_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"gear_item_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"reserved_from" date NOT NULL,
	"reserved_until" date NOT NULL,
	"checked_out_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"return_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gear_reservations_window" CHECK ("reserved_until" >= "reserved_from")
);
--> statement-breakpoint
CREATE TABLE "gear_service_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"gear_item_id" uuid NOT NULL,
	"kind" "gear_service_kind" NOT NULL,
	"serviced_on" date NOT NULL,
	"next_due_on" date,
	"note" text,
	"recorded_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gear_service_events_due_after_service" CHECK ("next_due_on" is null or "next_due_on" > "serviced_on")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gear_items_shop_label_unique" ON "gear_items" ("shop_id","label");--> statement-breakpoint
CREATE INDEX "gear_items_shop_kind_idx" ON "gear_items" ("shop_id","kind");--> statement-breakpoint
CREATE INDEX "gear_reservations_item_idx" ON "gear_reservations" ("gear_item_id");--> statement-breakpoint
CREATE INDEX "gear_reservations_booking_idx" ON "gear_reservations" ("booking_id");--> statement-breakpoint
CREATE INDEX "gear_reservations_shop_until_idx" ON "gear_reservations" ("shop_id","reserved_until");--> statement-breakpoint
CREATE INDEX "gear_service_events_item_idx" ON "gear_service_events" ("gear_item_id","serviced_on");--> statement-breakpoint
CREATE INDEX "gear_service_events_shop_idx" ON "gear_service_events" ("shop_id");--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_gear_item_id_gear_items_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gear_service_events" ADD CONSTRAINT "gear_service_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "gear_service_events" ADD CONSTRAINT "gear_service_events_gear_item_id_gear_items_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gear_service_events" ADD CONSTRAINT "gear_service_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
-- Hand-added (drizzle-kit has no EXCLUDE API): the double-booking guard the
-- gear register exists to provide, enforced by the database rather than an
-- application-level check two staff members can race past. Two OPEN
-- reservations (returned_at IS NULL) of the same unit may never overlap on
-- their inclusive [reserved_from, reserved_until] date ranges; a return
-- closes the reservation and frees the window. Violations surface as
-- SQLSTATE 23P01 — see violatesExclusionConstraint in src/db/client.ts.
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_no_overlap" EXCLUDE USING gist ("gear_item_id" WITH =, daterange("reserved_from", "reserved_until", '[]') WITH &&) WHERE ("returned_at" IS NULL);
