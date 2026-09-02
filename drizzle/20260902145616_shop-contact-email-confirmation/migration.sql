CREATE TABLE "shop_contact_email_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "contact_email_confirmed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "shop_contact_email_tokens_shop_idx" ON "shop_contact_email_tokens" ("shop_id");--> statement-breakpoint
ALTER TABLE "shop_contact_email_tokens" ADD CONSTRAINT "shop_contact_email_tokens_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");