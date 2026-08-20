CREATE TYPE "waiver_delivery_channel" AS ENUM('email', 'text', 'link');--> statement-breakpoint
CREATE TABLE "waiver_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"waiver_record_id" uuid NOT NULL,
	"channel" "waiver_delivery_channel" NOT NULL,
	"status" "notification_delivery_status" NOT NULL,
	"provider_message_id" text,
	"provider_status" "notification_provider_status",
	"provider_status_at" timestamp with time zone,
	"detail" text,
	"attempted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_deliveries_record_channel_unique" ON "waiver_deliveries" ("waiver_record_id","channel");--> statement-breakpoint
CREATE INDEX "waiver_deliveries_provider_message_idx" ON "waiver_deliveries" ("provider_message_id");--> statement-breakpoint
CREATE INDEX "waiver_deliveries_shop_record_idx" ON "waiver_deliveries" ("shop_id","waiver_record_id");--> statement-breakpoint
ALTER TABLE "waiver_deliveries" ADD CONSTRAINT "waiver_deliveries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_deliveries" ADD CONSTRAINT "waiver_deliveries_waiver_record_id_waiver_records_id_fkey" FOREIGN KEY ("waiver_record_id") REFERENCES "waiver_records"("id");