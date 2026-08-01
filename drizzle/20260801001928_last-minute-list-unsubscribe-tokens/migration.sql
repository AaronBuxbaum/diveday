CREATE TABLE "last_minute_list_unsubscribe_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "last_minute_list_unsubscribe_tokens_token_hash_idx" ON "last_minute_list_unsubscribe_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "last_minute_list_unsubscribe_tokens_entry_idx" ON "last_minute_list_unsubscribe_tokens" ("entry_id");--> statement-breakpoint
ALTER TABLE "last_minute_list_unsubscribe_tokens" ADD CONSTRAINT "last_minute_list_unsubscribe_tokens_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "last_minute_list_unsubscribe_tokens" ADD CONSTRAINT "last_minute_list_unsubscribe_tokens_AOSpe7xhTtoO_fkey" FOREIGN KEY ("entry_id") REFERENCES "last_minute_list_entries"("id");