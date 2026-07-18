CREATE TYPE "public"."gear_assignment_status" AS ENUM('assigned', 'returned');--> statement-breakpoint
CREATE TYPE "public"."gear_state" AS ENUM('available', 'assigned', 'service_hold', 'retired');--> statement-breakpoint
CREATE TYPE "public"."gear_type" AS ENUM('bcd', 'regulator', 'wetsuit', 'mask_fins', 'weights', 'tank');--> statement-breakpoint
CREATE TABLE "gear_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"gear_item_id" uuid NOT NULL,
	"status" "gear_assignment_status" DEFAULT 'assigned' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"returned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gear_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"label" text NOT NULL,
	"type" "gear_type" NOT NULL,
	"size" text,
	"state" "gear_state" DEFAULT 'available' NOT NULL,
	"service_due_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gear_assignments" ADD CONSTRAINT "gear_assignments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gear_assignments" ADD CONSTRAINT "gear_assignments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gear_assignments" ADD CONSTRAINT "gear_assignments_gear_item_id_gear_items_id_fk" FOREIGN KEY ("gear_item_id") REFERENCES "public"."gear_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gear_items" ADD CONSTRAINT "gear_items_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gear_assignments_booking_status_idx" ON "gear_assignments" USING btree ("booking_id","status");--> statement-breakpoint
CREATE INDEX "gear_assignments_gear_status_idx" ON "gear_assignments" USING btree ("gear_item_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "gear_items_shop_label_unique" ON "gear_items" USING btree ("shop_id","label");--> statement-breakpoint
CREATE INDEX "gear_items_shop_type_state_idx" ON "gear_items" USING btree ("shop_id","type","state");