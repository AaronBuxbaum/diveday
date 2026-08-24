CREATE TYPE "pre_departure_check_status" AS ENUM('checked', 'cleared');--> statement-breakpoint
CREATE TABLE "pre_departure_check_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"checklist_item_id" uuid NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"status" "pre_departure_check_status" NOT NULL,
	"source" "roll_call_source" DEFAULT 'live'::"roll_call_source" NOT NULL,
	"client_event_id" uuid,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "pre_departure_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pre_departure_check_events_shop_trip_item_occurred_idx" ON "pre_departure_check_events" ("shop_id","trip_id","checklist_item_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pre_departure_check_events_shop_client_event_unique" ON "pre_departure_check_events" ("shop_id","client_event_id");--> statement-breakpoint
CREATE INDEX "pre_departure_checklist_items_shop_order_idx" ON "pre_departure_checklist_items" ("shop_id","sort_order","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pre_departure_checklist_items_shop_label_unique" ON "pre_departure_checklist_items" ("shop_id","label") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "pre_departure_check_events" ADD CONSTRAINT "pre_departure_check_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_check_events" ADD CONSTRAINT "pre_departure_check_events_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_check_events" ADD CONSTRAINT "pre_departure_check_events_Sm6KHU4KNFB1_fkey" FOREIGN KEY ("checklist_item_id") REFERENCES "pre_departure_checklist_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pre_departure_check_events" ADD CONSTRAINT "pre_departure_check_events_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_checklist_items" ADD CONSTRAINT "pre_departure_checklist_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "pre_departure_checklist_items" ADD CONSTRAINT "pre_departure_checklist_items_c6mRO9ZNpkkg_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");