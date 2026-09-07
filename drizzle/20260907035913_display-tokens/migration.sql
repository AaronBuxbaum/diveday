CREATE TABLE "display_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"label" text NOT NULL,
	"show_names" boolean DEFAULT false NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_shown_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "display_tokens_token_hash_idx" ON "display_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "display_tokens_shop_live_idx" ON "display_tokens" ("shop_id","revoked_at");--> statement-breakpoint
ALTER TABLE "display_tokens" ADD CONSTRAINT "display_tokens_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "display_tokens" ADD CONSTRAINT "display_tokens_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");