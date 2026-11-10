CREATE TABLE "whatsapp_delivered_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"phone_number_id" text NOT NULL,
	"waba_id" text NOT NULL,
	"message_fingerprint" text NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"pricing_model" text,
	"category" text,
	"pricing_type" text,
	"billable" boolean,
	"recorded_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "shop_whatsapp_accounts" ADD COLUMN "number_assigned_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_delivered_usage_message_unique" ON "whatsapp_delivered_usage" ("shop_id","phone_number_id","message_fingerprint");--> statement-breakpoint
CREATE INDEX "whatsapp_delivered_usage_window_idx" ON "whatsapp_delivered_usage" ("shop_id","delivered_at");--> statement-breakpoint
CREATE INDEX "whatsapp_delivered_usage_retention_idx" ON "whatsapp_delivered_usage" ("delivered_at");--> statement-breakpoint
ALTER TABLE "whatsapp_delivered_usage" ADD CONSTRAINT "whatsapp_delivered_usage_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;