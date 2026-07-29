CREATE TYPE "notification_queue_status" AS ENUM('queued', 'processing', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "notification_rate_limit_state" (
	"key" text PRIMARY KEY,
	"next_allowed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_send_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL UNIQUE,
	"payload" jsonb NOT NULL,
	"status" "notification_queue_status" DEFAULT 'queued'::"notification_queue_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"provider_message_id" text,
	"http_status" integer,
	"error_code" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notification_send_queue_due_idx" ON "notification_send_queue" ("status","next_attempt_at","locked_until");--> statement-breakpoint
CREATE INDEX "notification_send_queue_shop_status_idx" ON "notification_send_queue" ("shop_id","status");--> statement-breakpoint
ALTER TABLE "notification_send_queue" ADD CONSTRAINT "notification_send_queue_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");