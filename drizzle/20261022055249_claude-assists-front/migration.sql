CREATE TABLE "website_setup_drafts" (
	"shop_id" uuid PRIMARY KEY,
	"host" text NOT NULL,
	"lines" jsonb NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "assist_intent" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "assist_urgent" boolean;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "assist_language" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "assist_translation" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "assist_translated_to" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "assisted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "website_setup_drafts" ADD CONSTRAINT "website_setup_drafts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;