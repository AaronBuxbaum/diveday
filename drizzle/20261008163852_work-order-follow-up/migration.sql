CREATE TYPE "customer_gear_notice_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "customer_gear_notice_kind" AS ENUM('ready_for_pickup', 'service_due');--> statement-breakpoint
CREATE TYPE "customer_gear_notice_status" AS ENUM('sending', 'sent', 'failed', 'not_configured', 'no_contact', 'opted_out');--> statement-breakpoint
CREATE TABLE "customer_gear_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"kind" "customer_gear_notice_kind" NOT NULL,
	"person_id" uuid NOT NULL,
	"work_order_id" uuid,
	"work_order_event_id" uuid,
	"customer_gear_item_id" uuid,
	"due_clock" "gear_service_kind",
	"due_on" date,
	"status" "customer_gear_notice_status" DEFAULT 'sending'::"customer_gear_notice_status" NOT NULL,
	"channel" "customer_gear_notice_channel",
	"sent_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE TABLE "customer_gear_reminder_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"customer_gear_item_id" uuid NOT NULL,
	"reminders_off_at" timestamp with time zone,
	"changed_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_gear_notices_ready_once" ON "customer_gear_notices" ("work_order_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_gear_notices_reminder_once" ON "customer_gear_notices" ("customer_gear_item_id","due_clock","due_on");--> statement-breakpoint
CREATE INDEX "customer_gear_notices_order_idx" ON "customer_gear_notices" ("work_order_id","seq");--> statement-breakpoint
CREATE INDEX "customer_gear_notices_item_idx" ON "customer_gear_notices" ("customer_gear_item_id","seq");--> statement-breakpoint
CREATE INDEX "customer_gear_notices_shop_idx" ON "customer_gear_notices" ("shop_id");--> statement-breakpoint
CREATE INDEX "customer_gear_notices_person_idx" ON "customer_gear_notices" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_gear_reminder_settings_item_unique" ON "customer_gear_reminder_settings" ("customer_gear_item_id");--> statement-breakpoint
CREATE INDEX "customer_gear_reminder_settings_shop_off_idx" ON "customer_gear_reminder_settings" ("shop_id") WHERE "reminders_off_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_bills_order_unique" ON "work_order_bills" ("order_id");--> statement-breakpoint
CREATE INDEX "work_order_bills_work_order_idx" ON "work_order_bills" ("work_order_id","seq");--> statement-breakpoint
CREATE INDEX "work_order_bills_shop_idx" ON "work_order_bills" ("shop_id");--> statement-breakpoint
ALTER TABLE "customer_gear_notices" ADD CONSTRAINT "customer_gear_notices_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_notices" ADD CONSTRAINT "customer_gear_notices_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_notices" ADD CONSTRAINT "customer_gear_notices_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "customer_gear_notices" ADD CONSTRAINT "customer_gear_notices_d071sGz7b9pz_fkey" FOREIGN KEY ("work_order_event_id") REFERENCES "work_order_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "customer_gear_notices" ADD CONSTRAINT "customer_gear_notices_qCgVQSEJoKL1_fkey" FOREIGN KEY ("customer_gear_item_id") REFERENCES "customer_gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "customer_gear_notices" ADD CONSTRAINT "customer_gear_notices_sent_by_person_id_people_id_fkey" FOREIGN KEY ("sent_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_reminder_settings" ADD CONSTRAINT "customer_gear_reminder_settings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "customer_gear_reminder_settings" ADD CONSTRAINT "customer_gear_reminder_settings_iDw4JOgthZ5q_fkey" FOREIGN KEY ("customer_gear_item_id") REFERENCES "customer_gear_items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "customer_gear_reminder_settings" ADD CONSTRAINT "customer_gear_reminder_settings_g1kkt2Hcr09S_fkey" FOREIGN KEY ("changed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "work_order_bills" ADD CONSTRAINT "work_order_bills_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "work_order_bills" ADD CONSTRAINT "work_order_bills_work_order_id_work_orders_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "work_order_bills" ADD CONSTRAINT "work_order_bills_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "work_order_bills" ADD CONSTRAINT "work_order_bills_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");