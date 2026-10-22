CREATE TABLE "lead_unsubscribe_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lead_unsubscribe_tokens_token_hash_idx" ON "lead_unsubscribe_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "lead_unsubscribe_tokens_lead_idx" ON "lead_unsubscribe_tokens" ("lead_id");--> statement-breakpoint
ALTER TABLE "lead_unsubscribe_tokens" ADD CONSTRAINT "lead_unsubscribe_tokens_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "lead_unsubscribe_tokens" ADD CONSTRAINT "lead_unsubscribe_tokens_lead_id_leads_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id");