CREATE TYPE "work_order_event_kind" AS ENUM('created', 'status_changed', 'technician_assigned', 'work_recorded');--> statement-breakpoint
CREATE TYPE "work_order_line_kind" AS ENUM('part', 'labor');--> statement-breakpoint
CREATE TYPE "work_order_outcome" AS ENUM('done', 'declined', 'unserviceable', 'condemned');--> statement-breakpoint
CREATE TYPE "work_order_status" AS ENUM('received', 'in_progress', 'waiting_on_parts', 'ready', 'picked_up');--> statement-breakpoint
CREATE TABLE "customer_gear_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "gear_item_kind" NOT NULL,
	"brand_model" text,
	"serial_number" text,
	"note" text,
	"service_due_on" date,
	"inspection_due_on" date,
	"hydro_due_on" date,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_care" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"customer_gear_item_id" uuid,
	"kind" "gear_service_kind" NOT NULL,
	"passed" boolean NOT NULL,
	"performed_on" date NOT NULL,
	"next_due_on" date,
	"next_due_dives" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_care_due_after_performed" CHECK ("next_due_on" is null or "next_due_on" > "performed_on")
);
--> statement-breakpoint
CREATE TABLE "work_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"kind" "work_order_event_kind" NOT NULL,
	"from_status" "work_order_status",
	"to_status" "work_order_status",
	"technician_person_id" uuid,
	"actor_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "work_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"customer_gear_item_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"kind" "work_order_line_kind" NOT NULL,
	"description" text NOT NULL,
	"quantity_hundredths" integer DEFAULT 100 NOT NULL,
	"unit_amount_cents" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_order_lines_quantity_positive" CHECK ("quantity_hundredths" > 0),
	CONSTRAINT "work_order_lines_amount_not_negative" CHECK ("unit_amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid,
	"gear_item_id" uuid,
	"number" integer NOT NULL,
	"status" "work_order_status" DEFAULT 'received'::"work_order_status" NOT NULL,
	"reported_problem" text NOT NULL,
	"promised_on" date,
	"technician_person_id" uuid,
	"technician_notes" text,
	"work_performed" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"outcome" "work_order_outcome",
	"outcome_note" text,
	"outcome_recorded_at" timestamp with time zone,
	"outcome_recorded_by_person_id" uuid,
	"unit_prior_status" "gear_item_status",
	"unit_prior_service_note" text,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_one_subject" CHECK (("person_id" is not null and "gear_item_id" is null) or ("person_id" is null and "gear_item_id" is not null))
);
--> statement-breakpoint
CREATE INDEX "customer_gear_items_shop_person_idx" ON "customer_gear_items" ("shop_id","person_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "customer_gear_items_shop_due_idx" ON "customer_gear_items" ("shop_id","service_due_on") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "work_order_care_order_idx" ON "work_order_care" ("work_order_id");--> statement-breakpoint
CREATE INDEX "work_order_care_shop_idx" ON "work_order_care" ("shop_id");--> statement-breakpoint
CREATE INDEX "work_order_events_order_idx" ON "work_order_events" ("work_order_id","seq");--> statement-breakpoint
CREATE INDEX "work_order_events_shop_idx" ON "work_order_events" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_items_unique" ON "work_order_items" ("work_order_id","customer_gear_item_id");--> statement-breakpoint
CREATE INDEX "work_order_items_item_idx" ON "work_order_items" ("customer_gear_item_id");--> statement-breakpoint
CREATE INDEX "work_order_items_shop_idx" ON "work_order_items" ("shop_id");--> statement-breakpoint
CREATE INDEX "work_order_lines_order_idx" ON "work_order_lines" ("work_order_id","created_at") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "work_order_lines_shop_idx" ON "work_order_lines" ("shop_id");--> statement-breakpoint
CREATE INDEX "work_orders_shop_status_idx" ON "work_orders" ("shop_id","status") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "work_orders_shop_person_idx" ON "work_orders" ("shop_id","person_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "work_orders_shop_gear_item_idx" ON "work_orders" ("shop_id","gear_item_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_orders_shop_number_unique" ON "work_orders" ("shop_id","number");--> statement-breakpoint
ALTER TABLE "customer_gear_items" ADD CONSTRAINT "customer_gear_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_items" ADD CONSTRAINT "customer_gear_items_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_items" ADD CONSTRAINT "customer_gear_items_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_order_care" ADD CONSTRAINT "work_order_care_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "work_order_care" ADD CONSTRAINT "work_order_care_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_order_care" ADD CONSTRAINT "work_order_care_Io8cAocyVQ75_fkey" FOREIGN KEY ("customer_gear_item_id") REFERENCES "customer_gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_technician_person_id_people_id_fkey" FOREIGN KEY ("technician_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_order_items" ADD CONSTRAINT "work_order_items_blltFGTz6mNk_fkey" FOREIGN KEY ("customer_gear_item_id") REFERENCES "customer_gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_gear_item_id_gear_items_id_fkey" FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_technician_person_id_people_id_fkey" FOREIGN KEY ("technician_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_outcome_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("outcome_recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");