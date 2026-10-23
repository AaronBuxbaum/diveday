CREATE TABLE "claude_call_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usage_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"system_text" text NOT NULL,
	"context_text" text,
	"content_text" text NOT NULL,
	"answer_text" text,
	"fetched_urls" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claude_usage" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "claude_usage" ADD COLUMN "request_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "claude_call_content_usage_unique" ON "claude_call_content" ("usage_id");--> statement-breakpoint
CREATE INDEX "claude_call_content_shop_created_at_idx" ON "claude_call_content" ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "claude_call_content_created_at_idx" ON "claude_call_content" ("created_at");--> statement-breakpoint
ALTER TABLE "claude_call_content" ADD CONSTRAINT "claude_call_content_usage_id_claude_usage_id_fkey" FOREIGN KEY ("usage_id") REFERENCES "claude_usage"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claude_call_content" ADD CONSTRAINT "claude_call_content_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;