CREATE TYPE "notification_delivery_status" AS ENUM('sent', 'failed', 'not_configured');--> statement-breakpoint
CREATE TYPE "notification_kind" AS ENUM('booking_confirmation', 'waiver_request');--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"provider_message_id" text,
	"attempted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_booking_kind_unique" ON "notification_deliveries" ("booking_id","kind");--> statement-breakpoint
CREATE INDEX "notification_deliveries_shop_status_attempted_idx" ON "notification_deliveries" ("shop_id","status","attempted_at");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");