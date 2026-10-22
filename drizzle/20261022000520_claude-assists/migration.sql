CREATE TABLE "claude_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "claude_suggestions_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "claude_usage_shop_created_at_idx" ON "claude_usage" ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "claude_usage_created_at_idx" ON "claude_usage" ("created_at");--> statement-breakpoint
ALTER TABLE "claude_usage" ADD CONSTRAINT "claude_usage_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;