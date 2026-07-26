CREATE TYPE "notification_provider_status" AS ENUM('sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed');--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "provider_status" "notification_provider_status";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "provider_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "provider_detail" text;--> statement-breakpoint
CREATE INDEX "notification_deliveries_provider_message_idx" ON "notification_deliveries" ("provider_message_id");