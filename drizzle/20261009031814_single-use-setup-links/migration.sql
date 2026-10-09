CREATE TABLE "shop_setup_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"token_hash" text NOT NULL,
	"setup_request_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"spent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shop_setup_links_token_hash_unique" ON "shop_setup_links" ("token_hash");--> statement-breakpoint
CREATE INDEX "shop_setup_links_request_idx" ON "shop_setup_links" ("setup_request_id");--> statement-breakpoint
ALTER TABLE "shop_setup_links" ADD CONSTRAINT "shop_setup_links_setup_request_id_setup_requests_id_fkey" FOREIGN KEY ("setup_request_id") REFERENCES "setup_requests"("id") ON DELETE CASCADE;