ALTER TABLE "notification_deliveries" ADD COLUMN "send_http_status" integer;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "send_error_code" text;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "send_error" text;--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD COLUMN "send_http_status" integer;--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD COLUMN "send_error_code" text;--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD COLUMN "send_error" text;