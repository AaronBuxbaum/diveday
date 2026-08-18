ALTER TABLE "waiver_records" ADD COLUMN "delivery_status" "notification_delivery_status";--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "delivery_provider_message_id" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "delivery_provider_status" "notification_provider_status";--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "delivery_provider_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "delivery_error" text;