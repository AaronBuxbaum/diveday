CREATE TABLE "demo_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"demo_shop_id" uuid NOT NULL,
	"shop_slug" text NOT NULL,
	"prospect_name" text NOT NULL,
	"prospect_site" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"fetch_count" integer DEFAULT 0 NOT NULL,
	"first_fetched_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"first_opened_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"active_count" integer DEFAULT 0 NOT NULL,
	"first_active_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	CONSTRAINT "demo_previews_counts_check" CHECK ("fetch_count" >= 0 and "open_count" >= 0 and "active_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "demo_previews_demo_shop_key" ON "demo_previews" ("demo_shop_id");--> statement-breakpoint
CREATE INDEX "demo_previews_created_idx" ON "demo_previews" ("created_at");