CREATE TABLE "person_shelf_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_opened_at" timestamp with time zone,
	"opens" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "person_shelf_tokens_token_hash_idx" ON "person_shelf_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "person_shelf_tokens_shop_person_idx" ON "person_shelf_tokens" ("shop_id","person_id","revoked_at");--> statement-breakpoint
ALTER TABLE "person_shelf_tokens" ADD CONSTRAINT "person_shelf_tokens_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "person_shelf_tokens" ADD CONSTRAINT "person_shelf_tokens_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");