CREATE TABLE "gear_service_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"gear_item_id" uuid NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"service_completed_at" timestamp with time zone NOT NULL,
	"next_service_due_at" timestamp with time zone,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gear_service_events" ADD CONSTRAINT "gear_service_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gear_service_events" ADD CONSTRAINT "gear_service_events_gear_item_id_gear_items_id_fk" FOREIGN KEY ("gear_item_id") REFERENCES "public"."gear_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gear_service_events" ADD CONSTRAINT "gear_service_events_recorded_by_person_id_people_id_fk" FOREIGN KEY ("recorded_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gear_service_events_shop_item_completed_idx" ON "gear_service_events" USING btree ("shop_id","gear_item_id","service_completed_at");